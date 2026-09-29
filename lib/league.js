import { q } from './db.js';
import { getMarket, outcomeOf, sidePrices } from './kalshi.js';
import { american, isLocked, parlayOdds, STAKE_PER_PLAYER, weekInfo } from './rules.js';

const live = new Map(); // ticker -> { at, market }, per warm function instance

async function market(ticker) {
  const hit = live.get(ticker);
  if (hit && Date.now() - hit.at < 30e3) return hit.market;
  const m = await getMarket(ticker);
  live.set(ticker, { at: Date.now(), market: m });
  return m;
}

const legStatus = (l) => (!l.outcome ? 'pending' : l.outcome === 'void' ? 'void' : l.outcome === l.side ? 'hit' : 'miss');

// Pull results from Kalshi for any unsettled legs; returns current markets for display.
export async function refreshLegs(legs) {
  const now = {};
  await Promise.all(legs.filter((l) => !l.outcome).map(async (l) => {
    try {
      const m = await market(l.ticker);
      now[l.ticker] = m;
      const outcome = outcomeOf(m);
      if (outcome) { await q('UPDATE legs SET outcome = $1 WHERE id = $2', [outcome, l.id]); l.outcome = outcome; }
    } catch { /* Kalshi unreachable: keep pending, try again next load */ }
  }));
  return now;
}

export async function weekState(week) {
  const info = weekInfo(week);
  const players = await q('SELECT id, name FROM players ORDER BY id');
  const legs = await q(`SELECT l.*, p.name AS player FROM legs l JOIN players p ON p.id = l.player_id
                        WHERE l.week = $1 ORDER BY l.created_at`, [week]);
  const markets = await refreshLegs(legs);
  const [meta = {}] = await q('SELECT placer, actual_odds, note FROM weeks WHERE week = $1', [week]);

  const rows = legs.map((l) => {
    const m = markets[l.ticker];
    const nowPrice = m ? sidePrices(m)[l.side] : null;
    return {
      player: l.player, playerId: l.player_id, ticker: l.ticker, game: l.game, label: l.label, side: l.side,
      price: l.price, odds: american(l.price), liveOdds: american(nowPrice), status: legStatus(l),
    };
  });
  const counted = rows.filter((r) => r.status !== 'void');
  const misses = rows.filter((r) => r.status === 'miss');
  const settled = rows.every((r) => r.status !== 'pending');
  const odds = parlayOdds(counted.map((r) => r.price));
  const stake = STAKE_PER_PLAYER * rows.length;

  return {
    ...info,
    locked: isLocked(week),
    placer: meta.placer || '',
    actualOdds: meta.actual_odds || '',
    note: meta.note || '',
    players,
    legs: rows,
    waitingOn: players.filter((p) => !rows.some((r) => r.playerId === p.id)).map((p) => p.name),
    parlay: {
      odds, stake,
      payout: odds == null ? null : Math.round(stake * (odds > 0 ? 1 + odds / 100 : 1 + 100 / -odds)),
      hits: rows.filter((r) => r.status === 'hit').length,
      misses: misses.length,
      pending: rows.filter((r) => r.status === 'pending').length,
      settled: rows.length > 0 && settled,
      won: rows.length > 0 && settled && misses.length === 0,
    },
    // Rule 2: the only leg that misses owes next week's $5.
    soleMiss: settled && misses.length === 1 ? misses[0].player : null,
  };
}

export async function season() {
  const legs = await q(`SELECT l.week, l.side, l.price, l.outcome, p.name AS player
                        FROM legs l JOIN players p ON p.id = l.player_id`);
  const players = await q('SELECT name FROM players ORDER BY id');
  const byWeek = new Map();
  for (const l of legs) (byWeek.get(l.week) || byWeek.set(l.week, []).get(l.week)).push(l);

  const stats = new Map(players.map((p) => [p.name, { player: p.name, legs: 0, hits: 0, misses: 0, pending: 0, soleMisses: 0, oddsSum: 0 }]));
  for (const l of legs) {
    const s = stats.get(l.player);
    s.legs++;
    s.oddsSum += american(l.price);
    const st = legStatus(l);
    if (st === 'hit') s.hits++; else if (st === 'miss') s.misses++; else if (st === 'pending') s.pending++;
  }
  let parlaysWon = 0, parlaysSettled = 0;
  for (const wk of byWeek.values()) {
    const sts = wk.map((l) => ({ ...l, st: legStatus(l) }));
    if (sts.some((l) => l.st === 'pending')) continue;
    parlaysSettled++;
    const misses = sts.filter((l) => l.st === 'miss');
    if (!misses.length) parlaysWon++;
    if (misses.length === 1) stats.get(misses[0].player).soleMisses++;
  }
  const table = [...stats.values()].map(({ oddsSum, ...s }) => ({
    ...s,
    hitRate: s.hits + s.misses ? s.hits / (s.hits + s.misses) : null,
    avgOdds: s.legs ? Math.round(oddsSum / s.legs) : null,
  })).sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1) || b.hits - a.hits || a.soleMisses - b.soleMisses);
  return { table, parlaysWon, parlaysSettled };
}
