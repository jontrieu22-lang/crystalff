import { update } from '../lib/store.js';
import { body, fail, requireAdmin, route } from '../lib/http.js';

// Host tools: week details and roster.
export const POST = route(async (req) => {
  requireAdmin(req);
  const b = await body(req);
  switch (b.action) {
    case 'check':
      return { ok: true };
    case 'week':
      await update((d) => { d.weeks[Number(b.week)] = { placer: b.placer || '', actualOdds: b.actualOdds || '', note: b.note || '' }; });
      return { ok: true };
    case 'clearWeek': {
      const week = Number(b.week);
      if (!week) fail(400, 'week required');
      let removed = 0;
      await update((d) => {
        const before = d.legs.length;
        d.legs = d.legs.filter((l) => l.week !== week);
        removed = before - d.legs.length;
      });
      return { ok: true, removed };
    }
    case 'addPlayer': {
      const name = String(b.name || '').trim().slice(0, 30);
      if (!name) fail(400, 'Name required');
      await update((d) => {
        if (d.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) fail(409, 'Name taken');
        d.players.push({ id: d.nextId++, name });
      });
      return { ok: true };
    }
    case 'removePlayer':
      await update((d) => {
        const id = Number(b.playerId);
        d.players = d.players.filter((p) => p.id !== id);
        d.legs = d.legs.filter((l) => l.playerId !== id);
      });
      return { ok: true };
    default:
      fail(400, 'Unknown action');
  }
});
