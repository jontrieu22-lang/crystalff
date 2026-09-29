// End-to-end test: API + PGlite + a fake Kalshi.
import http from 'node:http';
import assert from 'node:assert/strict';

// Week 4 of 2026 (locks Sat Oct 3). Freeze "now" before the lock.
const realNow = Date.now;
let now = Date.parse('2026-09-30T12:00:00Z');
Date.now = () => now;

const mk = (ticker, event, sub, yes_bid, yes_ask) => ({ ticker, event_ticker: event, yes_sub_title: sub, title: sub, status: 'active', result: '', yes_bid, yes_ask });
const events = {
  KXNFLGAME: [
    { event_ticker: 'KXNFLGAME-26OCT04BUFNE', series_ticker: 'KXNFLGAME', title: 'Buffalo at New England', markets: [
      mk('KXNFLGAME-26OCT04BUFNE-BUF', 'KXNFLGAME-26OCT04BUFNE', 'Buffalo', 60, 62),
      mk('KXNFLGAME-26OCT04BUFNE-NE', 'KXNFLGAME-26OCT04BUFNE', 'New England', 38, 40)] },
    // Thursday game: before the Saturday lock, must be excluded.
    { event_ticker: 'KXNFLGAME-26OCT01SEALA', series_ticker: 'KXNFLGAME', title: 'Seattle at LA', markets: [
      mk('KXNFLGAME-26OCT01SEALA-SEA', 'KXNFLGAME-26OCT01SEALA', 'Seattle', 50, 52)] },
  ],
  KXNFLANYTD: [
    { event_ticker: 'KXNFLANYTD-26OCT04BUFNE', series_ticker: 'KXNFLANYTD', title: 'Anytime TD', markets: [
      mk('KXNFLANYTD-26OCT04BUFNE-JALLEN', 'KXNFLANYTD-26OCT04BUFNE', 'Josh Allen', 40, 42),
      // Newer Kalshi responses carry prices as dollar strings.
      { ...mk('KXNFLANYTD-26OCT04BUFNE-JCOOK', 'KXNFLANYTD-26OCT04BUFNE', 'James Cook'), yes_bid_dollars: '0.55', yes_ask_dollars: '0.57' }] },
  ],
};
const markets = Object.fromEntries(Object.values(events).flat().flatMap((e) => e.markets).map((m) => [m.ticker, m]));

const kalshi = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const ticker = u.pathname.split('/').pop();
  let body;
  if (u.pathname === '/series') body = { series: [{ ticker: 'KXNFLGAME', title: 'Pro Football Game' }, { ticker: 'KXNFLANYTD', title: 'NFL Anytime Touchdown' }, { ticker: 'KXNBAGAME', title: 'NBA' }] };
  else if (u.pathname === '/events') body = { events: events[u.searchParams.get('series_ticker')] || [], cursor: '' };
  else if (u.pathname.startsWith('/markets/') && markets[ticker]) body = { market: markets[ticker] };
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(body || {}));
}).listen(0);
process.env.KALSHI_BASE = `http://localhost:${kalshi.address().port}`;
process.env.ADMIN_KEY = 'host';

const { usePglite, createServer } = await import('../dev.js');
await usePglite();
const app = createServer().listen(0);
const base = `http://localhost:${app.address().port}`;
const call = async (path, method = 'GET', body, admin) => {
  const r = await fetch(base + path, { method, body: body && JSON.stringify(body), headers: { 'x-admin-key': admin || '' } });
  return { status: r.status, data: await r.json() };
};

// Roster is seeded from the spreadsheet; current week computed from the date.
let wk = (await call('/api/week')).data;
assert.equal(wk.week, 4);
assert.equal(wk.locksAt, '2026-10-03T18:00:00.000Z'); // Sat 2 PM EDT
assert.equal(wk.players.length, 12);
const id = (name) => wk.players.find((p) => p.name === name).id;

// Catalog: only NFL games after the lock, grouped by game; both price formats read.
const cat = (await call('/api/catalog?week=4')).data;
assert.equal(cat.games.length, 1);
const [game] = cat.games;
assert.equal(game.title, 'Buffalo at New England');
const td = game.groups.find((g) => /Anytime/.test(g.title));
assert.equal(td.title, 'Anytime Touchdown');
assert.deepEqual(td.markets.find((m) => m.label === 'James Cook').yes, { price: 57, odds: -133, ok: true });
assert.equal(td.markets.find((m) => m.label === 'Josh Allen').yes.ok, false); // +138 > +120

// Picking rules.
const pick = (name, ticker, side) => call('/api/leg', 'POST', { week: 4, playerId: id(name), ticker, side, group: 'Test' });
assert.match((await pick('Josh', 'KXNFLANYTD-26OCT04BUFNE-JALLEN', 'yes')).data.error, /Max is \+120/);
assert.match((await pick('Josh', 'KXNFLGAME-26OCT01SEALA-SEA', 'yes')).data.error, /isn't part of Week 4/);
assert.equal((await pick('Josh', 'KXNFLGAME-26OCT04BUFNE-BUF', 'yes')).data.odds, -163);
assert.equal((await pick('Sam', 'KXNFLGAME-26OCT04BUFNE-BUF', 'no')).status, 409); // same market taken
assert.equal((await pick('Sam', 'KXNFLANYTD-26OCT04BUFNE-JCOOK', 'yes')).status, 200);
assert.equal((await pick('Keane', 'KXNFLANYTD-26OCT04BUFNE-JALLEN', 'no')).data.odds, -150);
assert.equal((await pick('Josh', 'KXNFLGAME-26OCT04BUFNE-NE', 'no')).status, 200); // replaces Josh's leg

wk = (await call('/api/week?week=4')).data;
assert.equal(wk.legs.length, 3);
assert.equal(wk.waitingOn.length, 9);
assert.equal(wk.legs.find((l) => l.player === 'Josh').odds, -163); // NO at 100 - 38 = 62

// After lock: no changes; Kalshi settles; Keane is the only miss.
now = Date.parse('2026-10-03T18:00:01Z');
assert.equal((await pick('Eric', 'KXNFLGAME-26OCT04BUFNE-BUF', 'yes')).status, 403);
Object.assign(markets['KXNFLGAME-26OCT04BUFNE-NE'], { status: 'finalized', result: 'no' });
Object.assign(markets['KXNFLANYTD-26OCT04BUFNE-JCOOK'], { status: 'finalized', result: 'yes' });
Object.assign(markets['KXNFLANYTD-26OCT04BUFNE-JALLEN'], { status: 'finalized', result: 'yes' });
wk = (await call('/api/week?week=4')).data;
assert.deepEqual(wk.legs.map((l) => [l.player, l.status]), [['Sam', 'hit'], ['Keane', 'miss'], ['Josh', 'hit']]);
assert.equal(wk.soleMiss, 'Keane');
assert.equal(wk.parlay.settled, true);

// Host tools.
assert.equal((await call('/api/admin', 'POST', { action: 'week', week: 4, placer: 'Ethan' })).status, 403);
assert.equal((await call('/api/admin', 'POST', { action: 'week', week: 4, placer: 'Ethan', actualOdds: '+450' }, 'host')).status, 200);
assert.equal((await call('/api/week?week=4')).data.placer, 'Ethan');

const s = (await call('/api/season')).data;
assert.equal(s.table.find((r) => r.player === 'Keane').soleMisses, 1);
assert.equal(s.table[0].hitRate, 1);

console.log('smoke test passed');
Date.now = realNow;
kalshi.close(); app.close(); process.exit(0);
