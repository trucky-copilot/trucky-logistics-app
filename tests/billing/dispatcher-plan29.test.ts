import { assertEquals } from 'jsr:@std/assert@1';
import { authorizePlanFeature } from '../../base44/shared/entitlements.ts';

// Dispatcher que pagó el plan de $29 recibe plan_29 (no plan_99).
Deno.test('servidor: dispatcher con plan_29 pagado recibe plan_29', async () => {
  const saved = Deno.env.get('BILLING_LIVE_ENFORCEMENT_ENABLED');
  Deno.env.delete('BILLING_LIVE_ENFORCEMENT_ENABLED');
  try {
    const org = { id: 'o1', subscription_status: 'active', plan_type: 'plan_29', account_type: 'dispatcher' };
    const entities = {
      OrganizationMember: { filter: async () => [{ organization_id: 'o1' }] },
      Organization: { filter: async () => [org] },
      TestAccount: { filter: async () => [] },
      DemoTrial: { filter: async () => [] },
      PlanModule: { filter: async () => [] },
    };
    const base44 = { asServiceRole: { entities }, entities };
    const r = await authorizePlanFeature(base44, { id: 'u1', email: 'd@x.com' }, 'chat');
    assertEquals(r.allowed, true);
    assertEquals(r.plan, 'plan_29');
  } finally {
    if (saved !== undefined) Deno.env.set('BILLING_LIVE_ENFORCEMENT_ENABLED', saved);
  }
});
