// League calendar and odds math.
export const MAX_ODDS = Number(process.env.MAX_ODDS || 120);           // rule 1: max +120 per leg
export const STAKE_PER_PLAYER = Number(process.env.STAKE || 5);         // $5 each
const SEASON_START = process.env.SEASON_START || '2026-09-10';          // Thursday of NFL week 1
const TZ = 'America/New_York';
const DAY = 864e5;

// UTC instant for a wall-clock time in New York.
export function nyTime(dateStr, hour, minute = 0) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let t = Date.UTC(y, m - 1, d, hour, minute);
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    const seen = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    t += Date.UTC(y, m - 1, d, hour, minute) - seen;
  }
  return new Date(t);
}

const addDays = (dateStr, n) => new Date(Date.parse(dateStr + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

// Week N runs Thursday..Monday; legs must be on games after the Saturday 2 PM ET lock (rule 3).
export function weekInfo(week) {
  const thursday = addDays(SEASON_START, 7 * (week - 1));
  return {
    week,
    lockDate: addDays(thursday, 2),
    lastDate: addDays(thursday, 5),              // through Tuesday (covers MNF)
    locksAt: nyTime(addDays(thursday, 2), 14).toISOString(),
  };
}

export function currentWeek(now = Date.now()) {
  for (let w = 1; w <= 22; w++) if (now < nyTime(weekInfo(w).lastDate, 4).getTime()) return w; // flips Tuesday 4 AM ET, after MNF
  return 22;
}

export const isLocked = (week, now = Date.now()) => now >= Date.parse(weekInfo(week).locksAt);

// Kalshi price (cents) -> American odds.
export function american(price) {
  if (!(price > 0 && price < 100)) return null;
  return price >= 50 ? -Math.round((price / (100 - price)) * 100) : Math.round(((100 - price) / price) * 100);
}
export const fmtOdds = (o) => (o == null ? '—' : o > 0 ? `+${o}` : `${o}`);
export const legAllowed = (price) => { const o = american(price); return o != null && o <= MAX_ODDS; };

// Parlay odds from each leg's implied probability (decimal = 100 / price).
export function parlayOdds(prices) {
  if (!prices.length) return null;
  const dec = prices.reduce((acc, p) => acc * (100 / p), 1);
  return dec >= 2 ? Math.round((dec - 1) * 100) : -Math.round(100 / (dec - 1));
}
