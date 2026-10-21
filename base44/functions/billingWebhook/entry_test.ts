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

Deno.test('rejects wrong signing secret, live events and non-POST requests', async () => {
  Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_local_placeholder');
  Deno.env.set('STRIPE_WEBHOOK_SECRET', 'local-signing-test-only');
  const stripe = new Stripe('sk_test_local_placeholder');
  const payload = JSON.stringify({ id: 'evt_live_local', type: 'customer.subscription.created', livemode: true, data: { object: { id: 'sub_local' } } });
  const wrong = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: 'different-test-secret' });
  const rejected = await handler(new Request('https://example.test', { method: 'POST', body: payload, headers: { 'stripe-signature': wrong } }), {});
  if (rejected.status !== 400) throw Error('wrong secret accepted');
  const sig = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: 'local-signing-test-only' });
  const live = await handler(new Request('https://example.test', { method: 'POST', body: payload, headers: { 'stripe-signature': sig } }), {});
  if (live.status !== 400 || (await live.json()).code !== 'LIVE_EVENTS_NOT_ALLOWED') throw Error('live event accepted');
  const get = await handler(new Request('https://example.test'), {});
  if (get.status !== 405) throw Error('GET accepted');
});

Deno.test('acknowledges signed irrelevant events without granting entitlement', async () => {
  const stripe = new Stripe('sk_test_local_placeholder');
  const payload = JSON.stringify({ id: 'evt_ignored', type: 'customer.created', livemode: false, data: { object: { id: 'cus_local' } } });
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: 'local-signing-test-only' });
  const response = await handler(new Request('https://example.test', { method: 'POST', body: payload, headers: { 'stripe-signature': signature } }), {});
  if (response.status !== 200 || (await response.json()).code !== 'IGNORED') throw Error('irrelevant event changed entitlement');
});
