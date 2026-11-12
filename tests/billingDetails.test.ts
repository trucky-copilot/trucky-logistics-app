import { assertEquals } from 'jsr:@std/assert@1';
import { cancelChange, chooseBillingMode, invoicesView, subscriptionBelongs, subscriptionView } from '../base44/shared/billingDetails.ts';

const env = { live: 'rk_live_x', test: 'sk_test_y' };

Deno.test('mi plan: real usa la llave real; pruebas solo la de pruebas; nunca se mezclan', () => {
  assertEquals(chooseBillingMode({ stripe_live_subscription_id: 'sub_L1', stripe_subscription_id: 'sub_T1' }, env).mode, 'live');
  assertEquals(chooseBillingMode({ stripe_subscription_id: 'sub_T1' }, env).mode, 'test');
  assertEquals(chooseBillingMode({ stripe_subscription_id: 'sub_T1' }, { test: 'sk_live_z' }), { mode: 'none', reason: 'TEST_KEY_REQUIRED' });
  assertEquals(chooseBillingMode({ stripe_live_subscription_id: 'sub_L1' }, { live: 'sk_test_z' }), { mode: 'none', reason: 'LIVE_KEY_REQUIRED' });
  assertEquals(chooseBillingMode({}, env), { mode: 'none', reason: 'NO_SUBSCRIPTION' });
});

Deno.test('mi plan: la suscripción debe ser de la misma empresa y del mismo modo', () => {
  const org = { id: 'o1', stripe_subscription_id: 'sub_T1' };
  const m = chooseBillingMode(org, env);
  assertEquals(subscriptionBelongs({ id: 'sub_T1', livemode: false, metadata: { org_id: 'o1' } }, org, m), true);
  assertEquals(subscriptionBelongs({ id: 'sub_T1', livemode: false, metadata: { org_id: 'otra' } }, org, m), false);
  assertEquals(subscriptionBelongs({ id: 'sub_T1', livemode: true, metadata: { org_id: 'o1' } }, org, m), false);
  const lorg = { id: 'o2', stripe_live_subscription_id: 'sub_L1', stripe_live_customer_id: 'cus_A' };
  const lm = chooseBillingMode(lorg, env);
  assertEquals(subscriptionBelongs({ id: 'sub_L1', livemode: true, customer: 'cus_A' }, lorg, lm), true);
  assertEquals(subscriptionBelongs({ id: 'sub_L1', livemode: true, customer: 'cus_B' }, lorg, lm), false);
});

Deno.test('mi plan: cancelar es al final del período y se puede reanudar', () => {
  assertEquals(cancelChange('cancelar', { status: 'active' }), { ok: true, cancel_at_period_end: true });
  assertEquals(cancelChange('cancelar', { status: 'active', cancel_at_period_end: true }).ok, false);
  assertEquals(cancelChange('reanudar', { status: 'active', cancel_at_period_end: true }), { ok: true, cancel_at_period_end: false });
  assertEquals(cancelChange('cancelar', { status: 'canceled' }).ok, false);
});

Deno.test('mi plan: vistas de suscripción y cobros', () => {
  const v = subscriptionView({ status: 'active', items: { data: [{ current_period_end: 1767225600 }] }, cancel_at_period_end: true });
  assertEquals(v.fin_periodo, '2026-01-01T00:00:00.000Z'); assertEquals(v.cancela_al_final, true);
  const inv = invoicesView([{ id: 'in_1', status: 'paid', amount_paid: 2900, currency: 'usd', created: 1767225600, hosted_invoice_url: 'https://invoice.stripe.com/x' }, { id: 'in_2', status: 'draft' }]);
  assertEquals(inv.length, 1); assertEquals(inv[0].monto, 29); assertEquals(inv[0].moneda, 'USD');
});
