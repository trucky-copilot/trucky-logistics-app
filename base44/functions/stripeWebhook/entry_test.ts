import handler from './entry.ts';
import Stripe from 'npm:stripe@23.0.0';
Deno.test('rejects unsigned requests and gates valid events', async () => {
  Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_local_placeholder');
  Deno.env.set('STRIPE_WEBHOOK_SECRET', 'local-signing-test-only');
  Deno.env.delete('STRIPE_WEBHOOK_TEST_ENABLED');
  const invalid = await handler(new Request('https://example.test', { method: 'POST', body: '{}' }), {});
  if (invalid.status !== 400) throw Error('invalid signature accepted');
  const payload = JSON.stringify({ id: 'evt_local', type: 'customer.subscription.created', livemode: false, data: { object: { id: 'sub_local' } } });
  const stripe = new Stripe('sk_test_local_placeholder');
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: 'local-signing-test-only' });
  const valid = await handler(new Request('https://example.test', { method: 'POST', body: payload, headers: { 'stripe-signature': signature } }), {});
  if (valid.status !== 503 || (await valid.json()).code !== 'PROVISIONING_NOT_ENABLED') throw Error('gate failed');
});
