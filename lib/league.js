import { load, update } from './store.js';
import { getMarket, outcomeOf, sidePrices } from './kalshi.js';
import { american, isLocked, isPoisonPill, parlayOdds, STAKE, weekInfo } from './rules.js';

const live = new Map(); // ticker -> { at, market }, per warm function instance

async function market(ticker) {
  const hit = live.get(ticker);
  if (hit && Date.now() - hit.at < 30e3) return hit.market;
  const m = await getMarket(ticker);
  live.set(ticker, { at: Date.now(), market: m });
  return m;
}

const legStatus = (l) => (!l.outcome ? 'pending' : l.outcome === 'void' ? 'void' : l.outcome === l.side ? 'hit' : 'miss');

// Look up unsettled legs on Kalshi; save any results; return current markets for display.
export async function refreshLegs(legs) {
  const markets = {};
  const settled = {};
  await Promise.all(legs.filter((l) => !l.outcome).map(async (l) => {
    try {
      const m = await market(l.ticker);
      markets[l.ticker] = m;
      const outcome = outcomeOf(m);
      if (outcome) { settled[l.id] = outcome; l.outcome = outcome; }
    } catch { /* Kalshi unreachable: keep pending, try again next load */ }
  }));
  if (Object.keys(settled).length) {
    await update((d) => { for (const l of d.legs) if (settled[l.id]) l.outcome = settled[l.id]; });
  }
  return markets;
}

export async function weekState(week) {
  const info = weekInfo(week);
  const data = await load();
  const name = new Map(data.players.map((p) => [p.id, p.name]));
  const legs = data.legs.filter((l) => l.week === week && name.has(l.playerId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const markets = await refreshLegs(legs);
  const meta = data.weeks[week] || {};

  const rows = legs.map((l) => {
    const m = markets[l.ticker];
    return {
      player: name.get(l.playerId), playerId: l.playerId, ticker: l.ticker, game: l.game, label: l.label, side: l.side,
      price: l.price, odds: american(l.price), pill: isPoisonPill(l.price), liveOdds: m ? american(sidePrices(m)[l.side]) : null, status: legStatus(l),
    };
  });
  const misses = rows.filter((r) => r.status === 'miss');
  const settled = rows.every((r) => r.status !== 'pending');
  const odds = parlayOdds(rows.filter((r) => r.status !== 'void').map((r) => r.price));
  const stake = rows.length ? STAKE : 0;
  const payoutAt = (o) => (o == null ? null : Math.round(stake * (o > 0 ? 1 + o / 100 : 1 + 100 / -o)));
  const soleMiss = settled && misses.length === 1 ? misses[0] : null;

  return {
    ...info,
    locked: isLocked(week),
    placer: meta.placer || '',
    loser: meta.loser || '',
    actualOdds: meta.actualOdds || '',
    note: meta.note || '',
    players: data.players,
    legs: rows,
    waitingOn: data.players.filter((p) => !rows.some((r) => r.playerId === p.id)).map((p) => p.name),
    parlay: {
      odds, stake,
      payout: payoutAt(odds),
      hits: rows.filter((r) => r.status === 'hit').length,
      misses: misses.length,
      pending: rows.filter((r) => r.status === 'pending').length,
      settled: rows.length > 0 && settled,
      won: rows.length > 0 && settled && misses.length === 0,
    },
    // Rule 2: the only leg that misses owes next week's $5.
    soleMiss: soleMiss?.player || null,
    // James Clause: a poison-pill leg (+600 or longer) that is the only miss owes
    // everyone what the parlay would have paid without it.
    jamesClause: soleMiss?.pill ? {
      player: soleMiss.player,
      owes: payoutAt(parlayOdds(rows.filter((r) => r !== soleMiss && r.status !== 'void').map((r) => r.price))),
    } : null,
  };
}

export async function season() {
  const data = await load();
  const stats = new Map(data.players.map((p) => [p.id, { player: p.name, legs: 0, hits: 0, misses: 0, pending: 0, soleMisses: 0, losses: 0, oddsSum: 0 }]));
  const byWeek = new Map();
  for (const l of data.legs) {
    const s = stats.get(l.playerId);
    if (!s) continue;
    s.legs++;
    s.oddsSum += american(l.price);
    const st = legStatus(l);
    if (st === 'hit') s.hits++; else if (st === 'miss') s.misses++; else if (st === 'pending') s.pending++;
    (byWeek.get(l.week) || byWeek.set(l.week, []).get(l.week)).push({ ...l, st });
  }
  // Loser of the week is set by the host per week (by player name).
  for (const w of Object.values(data.weeks)) {
    const s = [...stats.values()].find((x) => x.player === w.loser);
    if (s) s.losses++;
  }
  let parlaysWon = 0, parlaysSettled = 0;
  for (const wk of byWeek.values()) {
    if (wk.some((l) => l.st === 'pending')) continue;
    parlaysSettled++;
    const misses = wk.filter((l) => l.st === 'miss');
    if (!misses.length) parlaysWon++;
    if (misses.length === 1) stats.get(misses[0].playerId).soleMisses++;
  }
  const table = [...stats.values()].map(({ oddsSum, ...s }) => ({
    ...s,
    hitRate: s.hits + s.misses ? s.hits / (s.hits + s.misses) : null,
    avgOdds: s.legs ? Math.round(oddsSum / s.legs) : null,
  })).sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1) || b.hits - a.hits || a.soleMisses - b.soleMisses);
  return { table, parlaysWon, parlaysSettled };
}
