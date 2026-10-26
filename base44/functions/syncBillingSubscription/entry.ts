import { subscriptionProjection } from "./projection.mjs";
import { isDemoOrganization, demoRedis, registerDemoOrganization } from "./demoRegistry.ts";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import Stripe from 'npm:stripe@23.0.0';
export default async function syncBillingSubscription(req: Request, _ctx: unknown) {
  const reply = (code: string, status = 200) => new Response(JSON.stringify({ code }), { status, headers: { 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return reply('METHOD_NOT_ALLOWED', 405);
  const secret = Deno.env.get('TRUCKY_SERVER_SECRET');
  const supplied = req.headers.get('authorization') || '';
  if (!secret) return reply('UNAUTHORIZED', 401);
  // Hash both strings before constant-length comparison.
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const a = await hash(supplied), b = await hash(`Bearer ${secret}`);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  if (difference !== 0) return reply('UNAUTHORIZED', 401);

  try {
    const body = await req.json();
    const mode = body.mode || 'test';
    if (!['test','live'].includes(mode)) return reply('INVALID_MODE',400);
    const live = mode === 'live';
    if (Deno.env.get(live ? 'BILLING_SYNC_LIVE_ENABLED' : 'BILLING_SYNC_TEST_ENABLED') !== 'true') return reply('SYNC_NOT_ENABLED',503);
    const allowed = new Set((Deno.env.get('STRIPE_TEST_ORGANIZATION_IDS') || '').split(',').map(x => x.trim()).filter(Boolean));
    if (typeof body.organization_id !== 'string' || (!live && !allowed.has(body.organization_id) && !await isDemoOrganization(body.organization_id))) return reply('TEST_ORGANIZATION_NOT_ALLOWED', 403);
    if (typeof body.subscription_id !== 'string' || !/^sub_[a-zA-Z0-9]+$/.test(body.subscription_id)) return reply('INVALID_SUBSCRIPTION', 400);
    const key = Deno.env.get(live ? 'STRIPE_LIVE_SECRET_KEY' : 'STRIPE_SECRET_KEY');
    if (!key?.startsWith(live ? 'sk_live_' : 'sk_test_')) return reply('TEST_CONFIGURATION_REQUIRED', 503);
    // Never trust status/customer/trial dates received from the caller.
    const sub = await new Stripe(key).subscriptions.retrieve(body.subscription_id);
    if (sub.livemode !== live || sub.metadata.org_id !== body.organization_id) return reply('SUBSCRIPTION_MISMATCH', 409);

    const db = createClientFromRequest(req).asServiceRole.entities;
    const org = (await db.Organization.filter({ id: body.organization_id }))?.[0];
    if (!org) return reply('ORGANIZATION_NOT_FOUND', 404);
    let projection;
    try { projection = subscriptionProjection(org, sub, mode); }
    catch (error) {
      const code = error instanceof Error ? error.message : 'SUBSCRIPTION_MISMATCH';
      const allowed = ['SUBSCRIPTION_MISMATCH','STATUS_REQUIRES_MIGRATION','BILLING_MAPPING_CONFLICT','CUSTOMER_REQUIRED'];
      return reply(allowed.includes(code) ? code : 'SUBSCRIPTION_MISMATCH',409);
    }
    await db.Organization.update(org.id, projection);
    return new Response(JSON.stringify({code:'SUBSCRIPTION_RECONCILED',mode}), {status:200,headers:{'Content-Type':'application/json'}});
  } catch { return reply('RECONCILIATION_REQUIRED', 503); }
}
