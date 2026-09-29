import { q } from '../lib/db.js';
import { body, fail, requireAdmin, route } from '../lib/http.js';

// Host tools: week details and roster.
export const POST = route(async (req) => {
  requireAdmin(req);
  const b = await body(req);
  switch (b.action) {
    case 'check':
      return { ok: true };
    case 'week':
      await q(`INSERT INTO weeks (week, placer, actual_odds, note) VALUES ($1, $2, $3, $4)
               ON CONFLICT (week) DO UPDATE SET placer = $2, actual_odds = $3, note = $4`,
        [Number(b.week), b.placer || null, b.actualOdds || null, b.note || null]);
      return { ok: true };
    case 'addPlayer': {
      const name = String(b.name || '').trim().slice(0, 30);
      if (!name) fail(400, 'Name required');
      await q('INSERT INTO players (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
      return { ok: true };
    }
    case 'removePlayer':
      await q('DELETE FROM players WHERE id = $1', [Number(b.playerId)]);
      return { ok: true };
    default:
      fail(400, 'Unknown action');
  }
});
