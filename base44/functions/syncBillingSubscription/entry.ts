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
  if (Deno.env.get('BILLING_SYNC_TEST_ENABLED') !== 'true') return reply('SYNC_NOT_ENABLED', 503);
  try {
    const body = await req.json();
    const allowed = new Set((Deno.env.get('STRIPE_TEST_ORGANIZATION_IDS') || '').split(',').map(x => x.trim()).filter(Boolean));
    if (typeof body.organization_id !== 'string' || !allowed.has(body.organization_id)) return reply('TEST_ORGANIZATION_NOT_ALLOWED', 403);
    if (typeof body.subscription_id !== 'string' || !/^sub_[a-zA-Z0-9]+$/.test(body.subscription_id)) return reply('INVALID_SUBSCRIPTION', 400);
    const key = Deno.env.get('STRIPE_SECRET_KEY');
    if (!key?.startsWith('sk_test_')) return reply('TEST_CONFIGURATION_REQUIRED', 503);
    // Never trust status/customer/trial dates received from the caller.
    const sub = await new Stripe(key).subscriptions.retrieve(body.subscription_id);
    if (sub.livemode || sub.metadata.org_id !== body.organization_id) return reply('SUBSCRIPTION_MISMATCH', 409);
    if (!['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete'].includes(sub.status)) return reply('STATUS_REQUIRES_MIGRATION', 409);
    const db = createClientFromRequest(req).asServiceRole.entities;
    const org = (await db.Organization.filter({ id: body.organization_id }))?.[0];
    if (!org) return reply('ORGANIZATION_NOT_FOUND', 404);
    const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    if ((org.stripe_subscription_id && org.stripe_subscription_id !== sub.id) || (org.stripe_customer_id && org.stripe_customer_id !== customer)) return reply('BILLING_MAPPING_CONFLICT', 409);
    await db.Organization.update(org.id, {
      subscription_status: sub.status, stripe_subscription_id: sub.id,
      stripe_customer_id: customer,
      trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    });
    return reply('SUBSCRIPTION_RECONCILED');
  } catch { return reply('RECONCILIATION_REQUIRED', 503); }
}
