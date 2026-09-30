import { q } from '../lib/db.js';
import { body, fail, isAdmin, route } from '../lib/http.js';
import { gameOf, getMarket, inWeek, sidePrices } from '../lib/kalshi.js';
import { fmtOdds, isLocked, legAllowed, MAX_ODDS, weekInfo, american } from '../lib/rules.js';

const player = async (id) => (await q('SELECT * FROM players WHERE id = $1', [id]))[0] || fail(404, 'Unknown player');

// Add or replace your one leg for the week.
export const POST = route(async (req) => {
  const b = await body(req);
  const week = Number(b.week);
  const p = await player(Number(b.playerId));
  if (!week) fail(400, 'week required');
  if (isLocked(week) && !isAdmin(req)) fail(403, 'Picks are locked for this week');
  if (!['yes', 'no'].includes(b.side)) fail(400, 'side must be yes or no');

  const m = await getMarket(String(b.ticker || ''));
  if (m.status && !['active', 'open'].includes(m.status)) fail(400, 'That market is no longer open on Kalshi');
  const g = gameOf(m.event_ticker || '');
  if (!inWeek(m, weekInfo(week))) fail(400, `That game isn't part of Week ${week} (it kicks off before the lock or in another week)`);
  const taken = await q('SELECT p.name FROM legs l JOIN players p ON p.id = l.player_id WHERE l.week = $1 AND l.ticker = $2 AND l.player_id <> $3', [week, m.ticker, p.id]);
  if (taken.length) fail(409, `${taken[0].name} already has that leg`);
  const price = sidePrices(m)[b.side];
  if (!price) fail(400, 'No price on Kalshi for that side right now');
  if (!legAllowed(price)) fail(400, `That leg is ${fmtOdds(american(price))}. Max is +${MAX_ODDS}.`);


  const label = String(m.title || m.yes_sub_title || m.ticker).slice(0, 120);
  await q('DELETE FROM legs WHERE week = $1 AND player_id = $2', [week, p.id]);
  await q(`INSERT INTO legs (week, player_id, ticker, game, label, side, price) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [week, p.id, m.ticker, String(b.game || g.teams || '').slice(0, 80), label, b.side, price]);
  return { ok: true, price, odds: american(price) };
});

export const DELETE = route(async (req) => {
  const b = await body(req);
  const week = Number(b.week);
  if (isLocked(week) && !isAdmin(req)) fail(403, 'Picks are locked for this week');
  await q('DELETE FROM legs WHERE week = $1 AND player_id = $2', [week, Number(b.playerId)]);
  return { ok: true };
});
