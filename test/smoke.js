// End-to-end smoke test against a mock Kalshi server.
import http from 'node:http';
import assert from 'node:assert/strict';

const markets = {
  FED: { ticker: 'FED', title: 'Fed cuts?', status: 'active', result: '', yes_bid: 38, yes_ask: 40 },
  RAIN: { ticker: 'RAIN', title: 'Rain in NYC?', status: 'active', result: '', yes_bid_dollars: '0.70', yes_ask_dollars: '0.72' },
};
const kalshi = http.createServer((req, res) => {
  const m = markets[req.url.split('/').pop()];
  res.writeHead(m ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(m ? { market: m } : {}));
}).listen(0);
process.env.KALSHI_BASE = `http://localhost:${kalshi.address().port}`;
process.env.ADMIN_KEY = 'adm';

const { createApp } = await import('../server.js');
const { openDb } = await import('../db.js');
const app = createApp(openDb(':memory:')).listen(0);
const base = `http://localhost:${app.address().port}`;
const call = async (path, { method = 'GET', body, token, admin } = {}) => {
  const r = await fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { 'x-token': token || '', 'x-admin-key': admin || '' } });
  return { status: r.status, data: await r.json() };
};

const future = new Date(Date.now() + 3600e3).toISOString();
assert.equal((await call('/api/days', { method: 'POST', body: { date: '2026-09-29' } })).status, 403);
assert.equal((await call('/api/days', { method: 'POST', admin: 'adm', body: { date: '2026-09-29', locksAt: future } })).status, 200);

const a = (await call('/api/join', { method: 'POST', body: { name: 'Ann' } })).data;
const b = (await call('/api/join', { method: 'POST', body: { name: 'Bob' } })).data;
assert.equal((await call('/api/join', { method: 'POST', body: { name: 'ann' } })).status, 409);

// URL input accepted; prices normalized (cents and dollar-string forms).
const pa = await call('/api/picks', { method: 'POST', token: a.token, body: { date: '2026-09-29', ticker: 'https://kalshi.com/markets/kxfed/fed', side: 'yes' } });
assert.equal(pa.data.entry_price, 40);
assert.equal((await call('/api/picks', { method: 'POST', token: b.token, body: { date: '2026-09-29', ticker: 'RAIN', side: 'no' } })).data.entry_price, 30);
assert.equal((await call('/api/picks', { method: 'POST', token: a.token, body: { date: '2026-09-29', ticker: 'FED', side: 'no' } })).status, 409);

// Others' picks hidden before lock.
const before = (await call('/api/day?date=2026-09-29', { token: a.token })).data;
assert.equal(before.picks.length, 1); assert.equal(before.hiddenCount, 1);

// Lock, settle via Kalshi result, verify scoring.
await call('/api/days', { method: 'POST', admin: 'adm', body: { date: '2026-09-29', locksAt: new Date(Date.now() - 1000).toISOString() } });
markets.FED.result = 'yes'; markets.FED.status = 'finalized';
markets.RAIN.result = 'yes'; markets.RAIN.status = 'finalized';
const after = (await call('/api/day?date=2026-09-29', { token: a.token })).data;
assert.equal(after.picks.length, 2);
assert.deepEqual(after.leaderboard.map((r) => [r.player, r.points]), [['Ann', 60], ['Bob', -30]]);
assert.equal((await call('/api/picks', { method: 'POST', token: a.token, body: { date: '2026-09-29', ticker: 'RAIN', side: 'yes' } })).status, 403);

console.log('smoke test passed');
kalshi.close(); app.close(); process.exit(0);
