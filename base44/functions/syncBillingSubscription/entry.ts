import { reconcileLiveSubscription } from './live.ts';
import { assertMembershipProvenance } from './provenance.ts';
import { gateSyncRequest } from './gate.ts';
import { isDemoOrganization, demoRedis, registerDemoOrganization } from "./demoRegistry.ts";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import Stripe from 'npm:stripe@23.0.0';
export default async function syncBillingSubscription(req: Request, _ctx: unknown) {
  const reply = (code: string, status = 200) => new Response(JSON.stringify({ code }), { status, headers: { 'Content-Type': 'application/json' } });
  // Autenticación S2S, modo e indicadores: ver gate.ts (probado en tests/billing/live-sync-gate.test.ts).
  const gate = await gateSyncRequest(req, {
    secret: Deno.env.get('TRUCKY_SERVER_SECRET'),
    liveEnabled: Deno.env.get('BILLING_SYNC_LIVE_ENABLED') === 'true',
    testEnabled: Deno.env.get('BILLING_SYNC_TEST_ENABLED') === 'true',
  });
  if (gate.kind === 'response') return reply(gate.code, gate.status);
  const body: any = gate.body;
  try {
    if (gate.kind === 'live') {
      const db=createClientFromRequest(req).asServiceRole.entities;
      const ids=(value:string|undefined)=>new Set((value||'').split(',').map(s=>s.trim()).filter(s=>/^[A-Za-z0-9_-]{1,128}$/.test(s)));
      const result=await reconcileLiveSubscription(body,{
        enabled:true,orgIds:ids(Deno.env.get('BILLING_LINK_PILOT_ORG_IDS')),memberIds:ids(Deno.env.get('BILLING_LINK_PILOT_MEMBER_IDS')),
        prices:{owner_op:Deno.env.get('STRIPE_LIVE_PRICE_OWNER_OP'),fleet:Deno.env.get('STRIPE_LIVE_PRICE_FLEET')},
        redis:demoRedis,assertProvenance:assertMembershipProvenance,owner:()=>crypto.randomUUID(),now:()=>Date.now(),
        organizations:id=>db.Organization.filter({id}),members:q=>db.OrganizationMember.filter(q),
        update:(id,fields)=>db.Organization.update(id,fields),
        retrieve:async id=>{const key=Deno.env.get('STRIPE_LIVE_SECRET_KEY');
          if(!key||!/^(sk|rk)_live_.+/.test(key))throw Error('LIVE_KEY_REQUIRED');
          return await new Stripe(key,{timeout:12000,maxNetworkRetries:0}).subscriptions.retrieve(id);
        },
      });
      return new Response(JSON.stringify(result.body),{status:result.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    }
    const allowed = new Set((Deno.env.get('STRIPE_TEST_ORGANIZATION_IDS') || '').split(',').map(x => x.trim()).filter(Boolean));
    if (typeof body.organization_id !== 'string' || (!allowed.has(body.organization_id) && !await isDemoOrganization(body.organization_id))) return reply('TEST_ORGANIZATION_NOT_ALLOWED', 403);
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
    const firstItem = sub.items?.data?.[0];
    const unitAmount = firstItem?.price?.unit_amount;
    const priceId = typeof firstItem?.price?.id === 'string' ? firstItem.price.id : null;

    let planType = 'none';
    if (unitAmount === 2900) {
      planType = 'plan_29';
    } else if (unitAmount === 9900) {
      planType = 'plan_99';
    }

    await db.Organization.update(org.id, {
      subscription_status: sub.status,
      stripe_subscription_id: sub.id,
      stripe_customer_id: customer,
      plan_type: planType,
      stripe_price_id: priceId,
      trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    });
    return reply('SUBSCRIPTION_RECONCILED');
  } catch { return reply('RECONCILIATION_REQUIRED', 503); }
}
