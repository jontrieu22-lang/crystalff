import { load, update } from '../lib/store.js';
import { body, fail, isAdmin, route } from '../lib/http.js';
import { gameOf, getMarket, inWeek, sidePrices } from '../lib/kalshi.js';
import { american, isLocked, testMode, weekInfo } from '../lib/rules.js';

// Add or replace your one leg for the week.
export const POST = route(async (req) => {
  const b = await body(req);
  const week = Number(b.week);
  const playerId = Number(b.playerId);
  if (!week) fail(400, 'week required');
  if (b.test && !testMode()) fail(403, 'Test picks are off in production');
  const test = !!b.test;
  if (isLocked(week) && !isAdmin(req) && !test) fail(403, 'Picks are locked for this week');
  if (!['yes', 'no'].includes(b.side)) fail(400, 'side must be yes or no');

  const m = await getMarket(String(b.ticker || ''));
  if (m.status && !['active', 'open'].includes(m.status)) fail(400, 'That market is no longer open on Kalshi');
  if (!test && !inWeek(m, weekInfo(week))) fail(400, `That game isn't part of Week ${week} (only Sunday and Monday games after the lock count)`);
  const takenBy = (d) => {
    const t = d.legs.find((l) => l.week === week && l.ticker === m.ticker && l.playerId !== playerId);
    if (t) fail(409, `${d.players.find((p) => p.id === t.playerId)?.name || 'Someone'} already has that leg`);
  };
  takenBy(await load());
  const price = sidePrices(m)[b.side];
  if (!price) fail(400, 'No price on Kalshi for that side right now');

  await update((d) => {
    if (!d.players.some((p) => p.id === playerId)) fail(404, 'Unknown player');
    takenBy(d); // re-check inside the write in case someone grabbed it meanwhile
    d.legs = d.legs.filter((l) => !(l.week === week && l.playerId === playerId));
    d.legs.push({
      id: d.nextId++, week, playerId, ticker: m.ticker,
      game: String(b.game || gameOf(m.event_ticker || '').teams || '').slice(0, 80),
      label: String(m.title || m.yes_sub_title || m.ticker).slice(0, 120),
      side: b.side, price, outcome: null, createdAt: new Date().toISOString(),
      // Kept for live tracking: when the game starts and the line in structured form.
      // Test picks have no known start time, so they show as live right away.
      kickoff: test ? null : m.occurrence_datetime || null, test: test || undefined, event: m.event_ticker || null,
      line: { floor: m.floor_strike ?? null, cap: m.cap_strike ?? null, type: m.strike_type || null, custom: m.custom_strike ?? null, sub: m.yes_sub_title || null },
    });
  });
  return { ok: true, price, odds: american(price) };
});

export const DELETE = route(async (req) => {
  const b = await body(req);
  const week = Number(b.week);
  if (isLocked(week) && !isAdmin(req)) fail(403, 'Picks are locked for this week');
  await update((d) => { d.legs = d.legs.filter((l) => !(l.week === week && l.playerId === Number(b.playerId))); });
  return { ok: true };
});
