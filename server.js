import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, pickScore } from './db.js';
import { getMarket, parseTicker } from './kalshi.js';

const PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const ADMIN_KEY = process.env.ADMIN_KEY || '';      // required to create days / force-settle
const JOIN_CODE = process.env.JOIN_CODE || '';      // optional shared code to join
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

export function createApp(db = openDb()) {
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

  const player = (req) => {
    const t = req.headers['x-token'];
    return t ? one('SELECT * FROM players WHERE token = ?', t) : undefined;
  };
  const requireAdmin = (req) => {
    if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) fail(403, 'Admin key required');
  };
  const dayByDate = (date) => one('SELECT * FROM days WHERE date = ?', date) || fail(404, 'No such day');

  // Settle any open picks whose Kalshi market has resolved.
  async function settle(dayId) {
    const open = q('SELECT DISTINCT ticker FROM picks WHERE day_id = ? AND result IS NULL', dayId);
    await Promise.all(open.map(async ({ ticker }) => {
      try {
        const m = await getMarket(ticker);
        if (m.result === 'yes' || m.result === 'no')
          run('UPDATE picks SET result = ? WHERE ticker = ? AND result IS NULL', m.result, ticker);
      } catch { /* leave unsettled; retry next request */ }
    }));
  }

  function board(dayId) {
    const picks = q(`SELECT p.*, pl.name AS player FROM picks p JOIN players pl ON pl.id = p.player_id
                     WHERE p.day_id = ? ORDER BY p.created_at`, dayId)
      .map((p) => ({ ...p, score: pickScore(p) }));
    const by = new Map();
    for (const p of picks) {
      const r = by.get(p.player) || { player: p.player, picks: 0, settled: 0, correct: 0, points: 0 };
      r.picks++;
      if (p.score !== null) { r.settled++; r.points += p.score; if (p.score > 0) r.correct++; }
      by.set(p.player, r);
    }
    const leaderboard = [...by.values()].sort((a, b) => b.points - a.points || b.correct - a.correct);
    return { picks, leaderboard };
  }

  const routes = {
    'POST /api/join': async (req, body) => {
      const name = String(body.name || '').trim().slice(0, 30);
      if (!name) fail(400, 'Name required');
      if (JOIN_CODE && body.code !== JOIN_CODE) fail(403, 'Wrong join code');
      if (one('SELECT 1 FROM players WHERE name = ?', name)) fail(409, 'Name taken');
      const token = randomBytes(16).toString('hex');
      run('INSERT INTO players (name, token) VALUES (?, ?)', name, token);
      return { name, token };
    },
    'GET /api/days': async () => q('SELECT date, title, locks_at FROM days ORDER BY date DESC'),
    'POST /api/days': async (req, body) => {
      requireAdmin(req);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) fail(400, 'date must be YYYY-MM-DD');
      run('INSERT OR REPLACE INTO days (id, date, title, locks_at) VALUES ((SELECT id FROM days WHERE date = ?), ?, ?, ?)',
        body.date, body.date, body.title || null, body.locksAt || null);
      return dayByDate(body.date);
    },
    'GET /api/market': async (req, body, url) => {
      const ticker = parseTicker(url.searchParams.get('ticker'));
      if (!ticker) fail(400, 'ticker required');
      return getMarket(ticker);
    },
    'GET /api/day': async (req, body, url) => {
      const day = dayByDate(url.searchParams.get('date'));
      await settle(day.id);
      const b = board(day.id);
      const locked = !!day.locks_at && Date.now() >= Date.parse(day.locks_at);
      // Hide other players' picks until lock so nobody copies.
      const me = player(req);
      const picks = locked ? b.picks : b.picks.filter((p) => me && p.player === me.name);
      return { day, locked, leaderboard: b.leaderboard, picks, hiddenCount: b.picks.length - picks.length };
    },
    'POST /api/picks': async (req, body) => {
      const me = player(req) || fail(401, 'Join first');
      const day = dayByDate(body.date);
      if (day.locks_at && Date.now() >= Date.parse(day.locks_at)) fail(403, 'Picks are locked for this day');
      if (!['yes', 'no'].includes(body.side)) fail(400, 'side must be yes or no');
      const m = await getMarket(parseTicker(body.ticker));
      if (m.status && !['active', 'open'].includes(m.status)) fail(400, `Market is ${m.status}`);
      const entry = body.side === 'yes' ? m.yesPrice : m.noPrice;
      if (entry == null) fail(400, 'No price available for that market yet');
      try {
        run(`INSERT INTO picks (day_id, player_id, ticker, title, side, entry_price, note)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          day.id, me.id, m.ticker, m.title, body.side, entry, String(body.note || '').slice(0, 200));
      } catch { fail(409, 'You already picked that market today'); }
      return { ticker: m.ticker, side: body.side, entry_price: entry };
    },
    'DELETE /api/picks': async (req, body, url) => {
      const me = player(req) || fail(401, 'Join first');
      const day = dayByDate(url.searchParams.get('date'));
      if (day.locks_at && Date.now() >= Date.parse(day.locks_at)) fail(403, 'Picks are locked');
      run('DELETE FROM picks WHERE day_id = ? AND player_id = ? AND ticker = ?',
        day.id, me.id, parseTicker(url.searchParams.get('ticker')));
      return { ok: true };
    },
    // Fallback if Kalshi's API can't be reached / result is disputed.
    'POST /api/settle': async (req, body) => {
      requireAdmin(req);
      if (!['yes', 'no'].includes(body.result)) fail(400, 'result must be yes or no');
      run('UPDATE picks SET result = ? WHERE ticker = ?', body.result, parseTicker(body.ticker));
      return { ok: true };
    },
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, data, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };
    try {
      const handler = routes[`${req.method} ${url.pathname}`];
      if (handler) {
        let body = {};
        if (req.method === 'POST') {
          const chunks = []; for await (const c of req) chunks.push(c);
          body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        }
        return send(200, await handler(req, body, url));
      }
      if (url.pathname.startsWith('/api/')) fail(404, 'Not found');
      const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
      const file = join(PUBLIC, rel);
      if (!file.startsWith(PUBLIC)) fail(404, 'Not found');
      send(200, await readFile(file), MIME[extname(file)] || 'application/octet-stream');
    } catch (e) {
      send(e.code === 'ENOENT' ? 404 : e.status || 500, { error: e.status ? e.message : e.code === 'ENOENT' ? 'Not found' : 'Server error' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => console.log(`crystalff on http://localhost:${port}`));
}
