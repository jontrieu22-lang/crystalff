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

// Kalshi's per-game NFL series (checked against the live API, Sept 2026). There are
// ~350 KXNFL* series in total, mostly season-long futures, so we list the weekly
// ones instead of discovering them. Override with NFL_SERIES=TICKER:Title,...
const SERIES = [
  ['KXNFLGAME', 'Winner'], ['KXNFLSPREAD', 'Spread'], ['KXNFLTOTAL', 'Total points'],
  ['KXNFLTEAMTOTAL', 'Team total'], ['KXNFLTD', 'Touchdowns'], ['KXNFLPASSYDS', 'Passing yards'],
  ['KXNFLRSHYDS', 'Rushing yards'], ['KXNFLRECYDS', 'Receiving yards'],
];

export function nflSeries() {
  const list = process.env.NFL_SERIES ? process.env.NFL_SERIES.split(',').map((x) => x.trim().split(':')) : SERIES;
  return list.map(([ticker, title]) => ({ ticker, title: title || ticker }));
}

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

// Event tickers look like KXNFLGAME-26OCT04BUFNE: the suffix identifies the game.
export function gameOf(eventTicker) {
  const suffix = eventTicker.split('-').slice(1).join('-');
  const m = suffix.match(/^(\d{2})([A-Z]{3})(\d{2})(.*)$/);
  return { key: suffix, date: m && MONTHS[m[2]] ? `20${m[1]}-${MONTHS[m[2]]}-${m[3]}` : null, teams: m ? m[4] : suffix };
}

// A market can be a leg for this week if its game kicks off after the lock and
// before the week ends. Kalshi's occurrence_datetime is the scheduled kickoff.
export function inWeek(m, info) {
  const kickoff = m.occurrence_datetime || m.expected_expiration_time;
  if (kickoff) return kickoff > info.locksAt && kickoff.slice(0, 10) <= info.lastDate;
  const { date } = gameOf(m.event_ticker || '');
  return !!date && date >= info.lockDate && date <= info.lastDate;
}

const isOpen = (m) => !m.status || ['active', 'open'].includes(m.status);

// Every open Kalshi NFL market for games between the lock and the end of the week.
export async function weekCatalog(info) {
  return cached(`catalog:${info.week}`, 180, async () => {
    const series = nflSeries();
    const events = (await Promise.all(series.map((s) =>
      pages(`/events?series_ticker=${encodeURIComponent(s.ticker)}&status=open&with_nested_markets=true`, 'events')
        .then((evs) => evs.map((e) => ({ ...e, group: s.title, isGame: s.ticker === 'KXNFLGAME' })))
        .catch(() => [])))).flat();

    const games = new Map();
    for (const e of events) {
      const markets = (e.markets || []).filter((m) => isOpen(m) && inWeek(m, info)).map((m) => {
        const p = sidePrices(m);
        return {
          ticker: m.ticker,
          label: m.title || m.yes_sub_title,
          yes: p.yes && { price: p.yes, odds: american(p.yes), ok: legAllowed(p.yes) },
          no: p.no && { price: p.no, odds: american(p.no), ok: legAllowed(p.no) },
        };
      }).filter((m) => m.yes || m.no);
      if (!markets.length) continue;
      const g = gameOf(e.event_ticker);
      const kickoff = e.markets.find((m) => m.occurrence_datetime)?.occurrence_datetime || null;
      const game = games.get(g.key) || { key: g.key, date: g.date, kickoff, title: '', groups: [] };
      // "IND Colts vs WAS Commanders" from the game-winner event; props read "Indianapolis vs Washington: Touchdowns".
      if (e.isGame || !game.title) game.title = String(e.title || g.teams).split(':')[0].trim();
      game.groups.push({ title: e.group, markets });
      games.set(g.key, game);
    }
    const order = new Map(series.map((s, i) => [s.title, i]));
    for (const g of games.values()) g.groups.sort((a, b) => order.get(a.title) - order.get(b.title));
    return [...games.values()].sort((a, b) => String(a.kickoff || a.date).localeCompare(String(b.kickoff || b.date)) || a.title.localeCompare(b.title));
  });
}
