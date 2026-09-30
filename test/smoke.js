// End-to-end test: API + in-memory store + a fake Kalshi.
import http from 'node:http';
import assert from 'node:assert/strict';

// Week 4 of 2026 (locks Sat Oct 3). Freeze "now" before the lock.
const realNow = Date.now;
let now = Date.parse('2026-09-30T12:00:00Z');
Date.now = () => now;

// Shaped like live Kalshi responses: dollar-string prices, occurrence_datetime = kickoff.
const kick = (event) => (/OCT01/.test(event) ? '2026-10-02T00:15:00Z' : '2026-10-04T17:00:00Z');
const d = (c) => (c == null ? undefined : (c / 100).toFixed(4));
const mk = (ticker, event, sub, yes_bid, yes_ask) => ({ ticker, event_ticker: event, title: sub, yes_sub_title: sub, no_sub_title: sub, status: 'active', result: '',
  yes_bid_dollars: d(yes_bid), yes_ask_dollars: d(yes_ask), no_ask_dollars: d(yes_bid == null ? null : 100 - yes_bid), occurrence_datetime: kick(event) });
const events = {
  KXNFLGAME: [
    { event_ticker: 'KXNFLGAME-26OCT04BUFNE', series_ticker: 'KXNFLGAME', title: 'Buffalo at New England', markets: [
      mk('KXNFLGAME-26OCT04BUFNE-BUF', 'KXNFLGAME-26OCT04BUFNE', 'Buffalo', 60, 62),
      mk('KXNFLGAME-26OCT04BUFNE-NE', 'KXNFLGAME-26OCT04BUFNE', 'New England', 38, 40)] },
    // Thursday game: before the Sunday lock, must be excluded.
    { event_ticker: 'KXNFLGAME-26OCT01SEALA', series_ticker: 'KXNFLGAME', title: 'Seattle at LA', markets: [
      mk('KXNFLGAME-26OCT01SEALA-SEA', 'KXNFLGAME-26OCT01SEALA', 'Seattle', 50, 52)] },
  ],
  KXNFLTD: [
    { event_ticker: 'KXNFLTD-26OCT04BUFNE', series_ticker: 'KXNFLTD', title: 'Anytime TD', markets: [
      mk('KXNFLTD-26OCT04BUFNE-JALLEN', 'KXNFLTD-26OCT04BUFNE', 'Josh Allen', 40, 42),
      mk('KXNFLTD-26OCT04BUFNE-LONG', 'KXNFLTD-26OCT04BUFNE', 'Long Shot', 10, 12), // +733: poison pill
      // Older responses carried integer cents; both are read.
      { ...mk('KXNFLTD-26OCT04BUFNE-JCOOK', 'KXNFLTD-26OCT04BUFNE', 'James Cook'), yes_bid: 55, yes_ask: 57, no_ask_dollars: undefined }] },
  ],
};
const markets = Object.fromEntries(Object.values(events).flat().flatMap((e) => e.markets).map((m) => [m.ticker, m]));

const kalshi = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const ticker = u.pathname.split('/').pop();
  let body;
  if (u.pathname === '/events') body = { events: events[u.searchParams.get('series_ticker')] || [], cursor: '' };
  else if (u.pathname.startsWith('/markets/') && markets[ticker]) body = { market: markets[ticker] };
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(body || {}));
}).listen(0);
process.env.KALSHI_BASE = `http://localhost:${kalshi.address().port}`;
process.env.ADMIN_KEY = 'host';

const { useMemoryStore, createServer } = await import('../dev.js');
useMemoryStore();
const app = createServer().listen(0);
const base = `http://localhost:${app.address().port}`;
const call = async (path, method = 'GET', body, admin) => {
  const r = await fetch(base + path, { method, body: body && JSON.stringify(body), headers: { 'x-admin-key': admin || '' } });
  return { status: r.status, data: await r.json() };
};

// Roster is seeded from the spreadsheet; current week computed from the date.
let wk = (await call('/api/week')).data;
assert.equal(wk.week, 4);
assert.equal(wk.locksAt, '2026-10-04T16:00:00.000Z'); // Sun 9 AM PDT
assert.equal(wk.players.length, 12);
const id = (name) => wk.players.find((p) => p.name === name).id;

// Catalog: only NFL games after the lock, grouped by game; both price formats read.
const cat = (await call('/api/catalog?week=4')).data;
assert.equal(cat.games.length, 1);
const [game] = cat.games;
assert.equal(game.title, 'Buffalo at New England');
assert.deepEqual(game.groups.map((g) => g.title), ['Winner', 'Touchdowns']);
const td = game.groups[1];
assert.deepEqual(td.markets.find((m) => m.label === 'James Cook').yes, { price: 57, odds: -133, pill: false });
assert.equal(td.markets.find((m) => m.label === 'Long Shot').yes.pill, true); // +733 >= +600

// Picking rules.
const pick = (name, ticker, side) => call('/api/leg', 'POST', { week: 4, playerId: id(name), ticker, side, group: 'Test' });
assert.equal((await pick('Josh', 'KXNFLTD-26OCT04BUFNE-JALLEN', 'yes')).data.odds, 138); // no max odds any more
assert.match((await pick('Josh', 'KXNFLGAME-26OCT01SEALA-SEA', 'yes')).data.error, /isn't part of Week 4/);
assert.equal((await pick('Josh', 'KXNFLGAME-26OCT04BUFNE-BUF', 'yes')).data.odds, -163);
assert.equal((await pick('Sam', 'KXNFLGAME-26OCT04BUFNE-BUF', 'no')).status, 409); // same market taken
assert.equal((await pick('Sam', 'KXNFLTD-26OCT04BUFNE-JCOOK', 'yes')).status, 200);
assert.equal((await pick('Keane', 'KXNFLTD-26OCT04BUFNE-LONG', 'yes')).data.odds, 733);
assert.equal((await pick('Josh', 'KXNFLGAME-26OCT04BUFNE-NE', 'no')).status, 200); // replaces Josh's leg

wk = (await call('/api/week?week=4')).data;
assert.equal(wk.legs.length, 3);
assert.equal(wk.waitingOn.length, 9);
assert.equal(wk.legs.find((l) => l.player === 'Josh').odds, -163); // NO at 100 - 38 = 62
assert.equal(wk.legs.find((l) => l.player === 'Keane').pill, true);

// After lock: no changes; Kalshi settles; Keane's poison pill is the only miss.
now = Date.parse('2026-10-04T16:00:01Z');
assert.equal((await pick('Eric', 'KXNFLGAME-26OCT04BUFNE-BUF', 'yes')).status, 403);
Object.assign(markets['KXNFLGAME-26OCT04BUFNE-NE'], { status: 'finalized', result: 'no' });
Object.assign(markets['KXNFLTD-26OCT04BUFNE-JCOOK'], { status: 'finalized', result: 'yes' });
Object.assign(markets['KXNFLTD-26OCT04BUFNE-LONG'], { status: 'finalized', result: 'no' });
wk = (await call('/api/week?week=4')).data;
assert.deepEqual(wk.legs.map((l) => [l.player, l.status]), [['Sam', 'hit'], ['Keane', 'miss'], ['Josh', 'hit']]);
assert.equal(wk.soleMiss, 'Keane');
// James Clause: $15 pot at the other two legs' odds (57c and 62c -> +183) = $42.
assert.deepEqual(wk.jamesClause, { player: 'Keane', owes: 42 });
assert.equal(wk.parlay.settled, true);

// Host tools.
assert.equal((await call('/api/admin', 'POST', { action: 'week', week: 4, placer: 'Ethan' })).status, 403);
assert.equal((await call('/api/admin', 'POST', { action: 'week', week: 4, placer: 'Ethan', actualOdds: '+450' }, 'host')).status, 200);
assert.equal((await call('/api/week?week=4')).data.placer, 'Ethan');

const s = (await call('/api/season')).data;
assert.equal(s.table.find((r) => r.player === 'Keane').soleMisses, 1);
assert.equal(s.table[0].hitRate, 1);

// Host can wipe a week's picks.
assert.equal((await call('/api/admin', 'POST', { action: 'clearWeek', week: 4 })).status, 403);
assert.equal((await call('/api/admin', 'POST', { action: 'clearWeek', week: 4 }, 'host')).data.removed, 3);
assert.equal((await call('/api/week?week=4')).data.legs.length, 0);

// Storage: a backend whose version check never matches (the bug that broke saves in
// production) must still save, on the forced last attempt.
const store = await import('../lib/store.js');
const mem = store.memoryBackend();
store.setBackend({ read: async () => ({ ...(await mem.read()), etag: 'stale' }), write: (d, prev, o) => mem.write(d, prev, o) });
await store.update((d) => { d.weeks[9] = { note: 'saved' }; });
assert.equal((await mem.read()).data.weeks[9].note, 'saved');

console.log('smoke test passed');
Date.now = realNow;
kalshi.close(); app.close(); process.exit(0);
