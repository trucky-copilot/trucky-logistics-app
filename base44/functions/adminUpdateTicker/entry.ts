import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

export default async function adminUpdateTicker(req: Request, ctx: any) {
  const user = await ctx.auth.getUser();
  if (!user || (user.email !== 'luis.bermudez@ogma.com.co' && user.email !== 'luis.bermudez@ogm.com.co')) {
    return new Response('Unauthorized', { status: 403 });
  }

  const body = await req.json();
  const { dry_van, reefer, flatbed, step_deck, power_only, container, diesel } = body;

  const base44 = createClientFromRequest(req);
  const db = base44.db || ctx.database;
  
  const existing = await base44.entities.GlobalMarketTicker.filter({ id: 'global' });

  if (existing.length > 0) {
    await base44.entities.GlobalMarketTicker.update(existing[0].id, {
      dry_van: dry_van ?? null,
      reefer: reefer ?? null,
      flatbed: flatbed ?? null,
      step_deck: step_deck ?? null,
      power_only: power_only ?? null,
      container: container ?? null,
      diesel: diesel ?? null
    });
  } else {
    await base44.entities.GlobalMarketTicker.create({
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
