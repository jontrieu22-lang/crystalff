import { update } from '../lib/store.js';
import { body, fail, route } from '../lib/http.js';
import { lookup, sidePrices } from '../lib/kalshi.js';
import { american, isPoisonPill, testMode } from '../lib/rules.js';

// Test mode only (never production): find any Kalshi event to mock-pick, and wipe test picks.
const guard = () => { if (!testMode()) fail(404, 'Not found'); };
const isOpen = (m) => !m.status || ['active', 'open'].includes(m.status);

export const GET = route(async (req, url) => {
  guard();
  const { title, markets } = await lookup(url.searchParams.get('q'));
  return {
    title,
    markets: markets.filter(isOpen).map((m) => {
      const p = sidePrices(m);
      return {
        ticker: m.ticker, label: m.title || m.yes_sub_title || m.ticker,
        yes: p.yes && { price: p.yes, odds: american(p.yes), pill: isPoisonPill(p.yes) },
        no: p.no && { price: p.no, odds: american(p.no), pill: isPoisonPill(p.no) },
      };
    }).filter((m) => m.yes || m.no),
  };
});

export const DELETE = route(async (req) => {
  guard();
  const week = Number((await body(req)).week);
  if (!week) fail(400, 'week required');
  await update((d) => { d.legs = d.legs.filter((l) => l.week !== week); });
  return { ok: true };
});
