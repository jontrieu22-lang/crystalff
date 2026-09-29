// Thin client for Kalshi's public (unauthenticated) market data API.
const BASE = process.env.KALSHI_BASE || 'https://api.elections.kalshi.com/trade-api/v2';

// Kalshi has returned prices as integer cents (yes_ask) and as dollar strings
// (yes_ask_dollars). Normalize to integer cents, or null if absent.
function cents(m, key) {
  if (m[key] != null && m[key] !== '') return Math.round(Number(m[key]));
  const d = m[key + '_dollars'];
  if (d != null && d !== '') return Math.round(Number(d) * 100);
  return null;
}

export async function getMarket(ticker) {
  const res = await fetch(`${BASE}/markets/${encodeURIComponent(ticker)}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 404) throw Object.assign(new Error(`Market ${ticker} not found`), { status: 404 });
  if (!res.ok) throw Object.assign(new Error(`Kalshi error ${res.status}`), { status: 502 });
  const { market: m } = await res.json();
  const yesBid = cents(m, 'yes_bid');
  const yesAsk = cents(m, 'yes_ask');
  const last = cents(m, 'last_price');
  return {
    ticker: m.ticker,
    title: m.title || m.yes_sub_title || m.ticker,
    subtitle: m.yes_sub_title || '',
    status: m.status,
    result: m.result || '', // 'yes' | 'no' | ''
    closeTime: m.close_time || m.expiration_time || null,
    // Price a player "pays" to enter: buy YES at the ask, buy NO at 100 - yes bid.
    yesPrice: yesAsk ?? last,
    noPrice: yesBid != null ? 100 - yesBid : last != null ? 100 - last : null,
  };
}

// Accept a raw ticker or a kalshi.com URL (last path segment is the market ticker).
export function parseTicker(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    const seg = u.pathname.split('/').filter(Boolean).pop() || '';
    return seg.toUpperCase();
  } catch {
    return s.toUpperCase();
  }
}
