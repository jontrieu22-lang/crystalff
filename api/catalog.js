import { fail, route } from '../lib/http.js';
import { weekCatalog } from '../lib/kalshi.js';
import { weekInfo, POISON_PILL } from '../lib/rules.js';

// This week's pickable legs, straight from Kalshi.
export const GET = route(async (req, url) => {
  const week = Number(url.searchParams.get('week'));
  if (!week) fail(400, 'week required');
  return { poisonPill: POISON_PILL, games: await weekCatalog(weekInfo(week)) };
});
