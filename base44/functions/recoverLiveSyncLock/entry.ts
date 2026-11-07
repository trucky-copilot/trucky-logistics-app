import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { demoRedis } from './demoRegistry.ts';
import { recoverLiveSyncLock } from './recover.ts';

/**
 * recoverLiveSyncLock — recuperación administrativa del bloqueo de la
 * sincronización live (ver recover.ts y docs/live-subscription-sync-phase3.md).
 * Sesión nativa de administrador; nunca acepta el secreto S2S ni tokens.
 * Variables: BILLING_SYNC_RECOVERY_ENABLED (apagada por defecto) y
 * BILLING_SYNC_RECOVERY_ADMIN_IDS (IDs de usuario Base44 autorizados).
 */
export default async function handler(req: Request, _ctx: unknown) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (code: string, status: number) => new Response(JSON.stringify({ code }), { status, headers });
  if (req.method !== 'POST') return reply('METHOD_NOT_ALLOWED', 405);
  const enabled = Deno.env.get('BILLING_SYNC_RECOVERY_ENABLED') === 'true';
  if (!enabled) return reply('RECOVERY_NOT_ENABLED', 503);
  try {
    let body: unknown;
    try { body = await req.json(); } catch { return reply('INVALID_REQUEST', 400); }
    const client = createClientFromRequest(req);
    const db = client.asServiceRole.entities;
    const result = await recoverLiveSyncLock(body, {
      enabled,
      adminIds: new Set((Deno.env.get('BILLING_SYNC_RECOVERY_ADMIN_IDS') || '').split(',').map((s) => s.trim()).filter(Boolean)),
      getCaller: () => client.auth.me(),
      redis: demoRedis,
      organizations: (id) => db.Organization.filter({ id }),
      now: () => Date.now(),
    });
    return new Response(JSON.stringify(result.body), { status: result.status, headers });
  } catch {
    return reply('RECOVERY_REQUIRES_REVIEW', 503);
  }
}
