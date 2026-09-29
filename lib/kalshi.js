// Read-only client for Kalshi's public market data API (no account needed).
import { cached } from './db.js';
import { american, legAllowed } from './rules.js';

const BASE = () => process.env.KALSHI_BASE || 'https://api.elections.kalshi.com/trade-api/v2';

async function get(path) {
  const res = await fetch(BASE() + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw Object.assign(new Error(`Kalshi ${res.status} for ${path}`), { status: res.status === 404 ? 404 : 502 });
  return res.json();
}

// Kalshi has used integer cents (yes_ask) and dollar strings (yes_ask_dollars).
function cents(m, key) {
  if (m[key] != null && m[key] !== '') return Math.round(Number(m[key]));
  const d = m[key + '_dollars'];
  return d != null && d !== '' ? Math.round(Number(d) * 100) : null;
}
const valid = (p) => (p > 0 && p < 100 ? p : null);

// Cost to take each side right now: YES at the yes ask, NO at the no ask (= 100 - yes bid).
export function sidePrices(m) {
  const yesBid = cents(m, 'yes_bid');
  return {
    yes: valid(cents(m, 'yes_ask')),
    no: valid(cents(m, 'no_ask') ?? (yesBid != null ? 100 - yesBid : null)),
  };
}

export function outcomeOf(m) {
  const r = String(m.result || '').toLowerCase();
  if (r === 'yes' || r === 'no') return r;
  if (r === 'void' || r === 'scalar') return 'void';
  return null;
}

export async function getMarket(ticker) {
  return (await get(`/markets/${encodeURIComponent(ticker)}`)).market;
}

async function pages(path, key) {
  const out = [];
  let cursor = '';
  for (let i = 0; i < 25; i++) {
    const data = await get(`${path}${path.includes('?') ? '&' : '?'}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    out.push(...(data[key] || []));
    cursor = data.cursor;
    if (!cursor) break;
  }
  return out;
}

// All NFL series on Kalshi (game lines + player props). Override with NFL_SERIES=A,B,C.
export async function nflSeries() {
  if (process.env.NFL_SERIES) return process.env.NFL_SERIES.split(',').map((t) => ({ ticker: t.trim(), title: t.trim() }));
  return cached('nfl-series', 6 * 3600, async () => {
    const { series = [] } = await get('/series?category=Sports');
    return series.filter((s) => /^KXNFL/i.test(s.ticker)).map((s) => ({ ticker: s.ticker, title: s.title }));
  });
}

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

// Event tickers look like KXNFLGAME-26OCT04BUFNE: the suffix identifies the game.
export function gameOf(eventTicker) {
  const suffix = eventTicker.split('-').slice(1).join('-');
  const m = suffix.match(/^(\d{2})([A-Z]{3})(\d{2})(.*)$/);
  return { key: suffix, date: m && MONTHS[m[2]] ? `20${m[1]}-${MONTHS[m[2]]}-${m[3]}` : null, teams: m ? m[4] : suffix };
}

const shortTitle = (t = '') => t.replace(/^(Pro Football|NFL)\s*/i, '').trim() || t;

// Every open Kalshi NFL market for games between the lock and the end of the week.
export async function weekCatalog(info) {
  return cached(`catalog:${info.week}`, 180, async () => {
    const series = await nflSeries();
    const events = [];
    for (let i = 0; i < series.length; i += 4) {
      const batch = await Promise.all(series.slice(i, i + 4).map((s) =>
        pages(`/events?series_ticker=${encodeURIComponent(s.ticker)}&status=open&with_nested_markets=true`, 'events')
          .then((evs) => evs.map((e) => ({ ...e, seriesTitle: s.title })))
          .catch(() => [])));
      events.push(...batch.flat());
    }

    const games = new Map();
    for (const e of events) {
      const g = gameOf(e.event_ticker);
      const date = g.date || String(e.markets?.[0]?.expected_expiration_time || '').slice(0, 10);
      if (!date || date < info.lockDate || date > info.lastDate) continue;
      const game = games.get(g.key) || { key: g.key, date, title: '', groups: [] };
      if (/GAME$/i.test(e.series_ticker || '') || !game.title) game.title = e.title || g.teams;
      const markets = (e.markets || []).filter((m) => !m.status || ['active', 'open'].includes(m.status)).map((m) => {
        const p = sidePrices(m);
        return {
          ticker: m.ticker,
          label: m.yes_sub_title || m.subtitle || m.title,
          yes: p.yes && { price: p.yes, odds: american(p.yes), ok: legAllowed(p.yes) },
          no: p.no && { price: p.no, odds: american(p.no), ok: legAllowed(p.no) },
        };
      }).filter((m) => m.yes || m.no);
      if (markets.length) game.groups.push({ title: shortTitle(e.seriesTitle || e.title), event: e.title, markets });
      games.set(g.key, game);
    }
    return [...games.values()].filter((g) => g.groups.length).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  });
}
