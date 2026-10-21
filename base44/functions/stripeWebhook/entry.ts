import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import Stripe from 'npm:stripe@23.0.0';

const EVENTS = new Set([
  'customer.subscription.created', 'customer.subscription.updated',
  'customer.subscription.deleted', 'customer.subscription.trial_will_end',
  'invoice.paid', 'invoice.payment_failed',
  'checkout.session.completed', 'checkout.session.expired',
]);
const STATUSES = new Set(['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']);
const reply = (status: number, code: string) => new Response(JSON.stringify({ code }), {
  status, headers: { 'Content-Type': 'application/json' },
});

async function redis(command: unknown[]) {
  const url = Deno.env.get('CHECKOUT_REDIS_REST_URL');
  const token = Deno.env.get('CHECKOUT_REDIS_REST_TOKEN');
  if (!url || !token || new URL(url).protocol !== 'https:') throw Error('REDIS_CONFIGURATION_REQUIRED');
  const res = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw Error('REDIS_UNAVAILABLE');
  const data = await res.json();
  if (data.error || !Object.hasOwn(data, 'result')) throw Error('REDIS_UNAVAILABLE');
  return data.result;
}

export default async function stripeWebhook(req: Request, _ctx: unknown) {
  if (req.method !== 'POST') return reply(405, 'METHOD_NOT_ALLOWED');
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  const signingSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!key?.startsWith('sk_test_') || !signingSecret) return reply(503, 'TEST_CONFIGURATION_REQUIRED');
  const stripe = new Stripe(key);
  let event: Stripe.Event;
  try {
    const raw = await req.text();
    if (raw.length > 1048576) return reply(413, 'PAYLOAD_TOO_LARGE');
    event = await stripe.webhooks.constructEventAsync(raw, req.headers.get('stripe-signature') || '', signingSecret);
  } catch { return reply(400, 'INVALID_SIGNATURE'); }
  if (event.livemode) return reply(400, 'LIVE_EVENTS_NOT_ALLOWED');
  if (!EVENTS.has(event.type)) return reply(200, 'IGNORED');
  // Keep disabled until database RLS and actual product access enforcement are audited.
  if (Deno.env.get('STRIPE_WEBHOOK_TEST_ENABLED') !== 'true') return reply(503, 'PROVISIONING_NOT_ENABLED');

  let lockKey: string | undefined;
  let owner: string | undefined;
  let acquired = false;
  let databaseWriteStarted = false;
  let completed = false;
  try {
    const object = event.data.object as any;
    let subscriptionId: string | undefined;
    if (event.type.startsWith('customer.subscription.')) subscriptionId = object.id;
    else if (event.type.startsWith('checkout.session.')) {
      subscriptionId = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id;
      // Expired/abandoned checkout never grants access or unlocks a new purchase here.
      if (!subscriptionId) return reply(200, 'NO_ENTITLEMENT_CHANGE');
    } else {
      const sub = object.parent?.subscription_details?.subscription ?? object.subscription;
      subscriptionId = typeof sub === 'string' ? sub : sub?.id;
      if (!subscriptionId) return reply(200, 'NO_SUBSCRIPTION');
    }
    if (!subscriptionId?.startsWith('sub_')) return reply(400, 'INVALID_SUBSCRIPTION');
    // First read only resolves routing. Re-read after acquiring organization lock.
    let subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const orgId = subscription.metadata.org_id;
    if (!orgId || !/^[a-zA-Z0-9_-]{1,128}$/.test(orgId)) return reply(409, 'ORGANIZATION_METADATA_REQUIRED');
    // Server-controlled allowlist. No workspace/demo flag supplied by a client
    // can authorize billing updates to an existing customer organization.
    const allowed = new Set((Deno.env.get('STRIPE_TEST_ORGANIZATION_IDS') || '')
      .split(',').map(value => value.trim()).filter(Boolean));
    if (!allowed.has(orgId)) return reply(403, 'TEST_ORGANIZATION_NOT_ALLOWED');
    lockKey = `trucky:webhook:test:org:${orgId}`;
    owner = crypto.randomUUID();
    acquired = await redis(['SET', lockKey, owner, 'NX']) === 'OK';
    if (!acquired) return reply(503, 'RECONCILIATION_BUSY');
    const eventKey = `trucky:webhook:test:processed:${event.id}`;
    if (await redis(['GET', eventKey])) { completed = true; return reply(200, 'ALREADY_PROCESSED'); }
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (subscription.livemode || subscription.metadata.org_id !== orgId || !STATUSES.has(subscription.status)) throw Error('SUBSCRIPTION_MISMATCH');
    const db = createClientFromRequest(req).asServiceRole.entities;
    const organizations = await db.Organization.filter({ id: orgId });
    const org = organizations?.[0];
    if (!org) throw Error('ORGANIZATION_NOT_FOUND');
    if (org.stripe_subscription_id && org.stripe_subscription_id !== subscription.id) throw Error('SUBSCRIPTION_CONFLICT');
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    if (org.stripe_customer_id && org.stripe_customer_id !== customerId) throw Error('CUSTOMER_CONFLICT');
    // Existing schema does not support these statuses yet: never mutate schema
    // globally for this isolated test deployment.
    if (['paused', 'incomplete_expired'].includes(subscription.status)) throw Error('STATUS_REQUIRES_SCHEMA_MIGRATION');
    databaseWriteStarted = true;
    await db.Organization.update(org.id, {
      stripe_subscription_id: subscription.id,
      stripe_customer_id: customerId,
      subscription_status: subscription.status,
      trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
    });
    await redis(['SET', eventKey, subscription.id]);
    completed = true;
    return reply(200, 'SUBSCRIPTION_RECONCILED');
  } catch {
    // Never log payloads, signatures, ID tokens or credentials.
    return reply(503, 'RECONCILIATION_REQUIRED');
  } finally {
    // No lease expiry: an uncertain database write cannot overlap a newer writer.
    // A crash/uncertain write requires operator reconciliation before removing lock.
    if (acquired && lockKey && owner && (!databaseWriteStarted || completed)) {
      try {
        await redis(['EVAL', "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", '1', lockKey, owner]);
      } catch { /* Keep blocked on uncertainty; Stripe retries receive 503. */ }
    }
  }
}
