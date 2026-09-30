import type { Context } from '@base44/functions';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

export default async function adminUpdateTicker(req: Request, ctx: Context) {
  const user = await ctx.auth.getUser();
  if (!user || (user.email !== 'luis.bermudez@ogma.com.co' && user.email !== 'luis.bermudez@ogm.com.co')) {
    return new Response('Unauthorized', { status: 403 });
  }

  const body = await req.json();
  const { dry_van, reefer, flatbed, step_deck, power_only, container, diesel } = body;

  const base44 = createClientFromRequest(req);
  const db = base44.db || ctx.database;
  
  // Asumimos que solo hay un registro global (id 'global')
  const existing = await db.query('GlobalMarketTicker').filter('id', 'eq', 'global').first();

  if (existing) {
    await db.update('GlobalMarketTicker', 'global', {
      dry_van: dry_van ?? null,
      reefer: reefer ?? null,
      flatbed: flatbed ?? null,
      step_deck: step_deck ?? null,
      power_only: power_only ?? null,
      container: container ?? null,
      diesel: diesel ?? null
    });
  } else {
    await db.insert('GlobalMarketTicker', {
      id: 'global',
      dry_van: dry_van ?? null,
      reefer: reefer ?? null,
      flatbed: flatbed ?? null,
      step_deck: step_deck ?? null,
      power_only: power_only ?? null,
      container: container ?? null,
      diesel: diesel ?? null
    });
  }

  return Response.json({ success: true });
}
