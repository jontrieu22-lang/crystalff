import { q } from '../lib/db.js';
import { fail, route } from '../lib/http.js';
import { refreshLegs } from '../lib/league.js';

// Daily Vercel Cron: settle any legs whose Kalshi markets have resolved.
export const GET = route(async (req) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) fail(401, 'Unauthorized');
  const legs = await q('SELECT * FROM legs WHERE outcome IS NULL');
  await refreshLegs(legs);
  return { checked: legs.length, settled: legs.filter((l) => l.outcome).length };
});
