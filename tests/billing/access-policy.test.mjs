import test from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionAccess } from '../../base44/functions/stripeWebhook/access-policy.mjs';
test('existing explicitly exempt organizations retain access regardless of billing state', () => {
  for (const subscription_status of ['none', 'canceled', 'past_due', undefined]) {
    assert.equal(subscriptionAccess({ billing_access_mode: 'legacy_exempt', subscription_status }).allowed, true);
  }
});
test('new companies have full trial until its exact end', () => {
  const org = { billing_access_mode: 'subscription_required', subscription_status: 'trialing', trial_ends_at: '2026-12-01T00:00:00Z' };
  const end = Date.parse(org.trial_ends_at);
  assert.equal(subscriptionAccess(org, end - 1).allowed, true);
  assert.equal(subscriptionAccess(org, end).allowed, false);
});
test('missing classification is migration-required, not a hidden free entitlement', () => {
  assert.equal(subscriptionAccess({}).reason, 'migration_required');
});
test('new companies cannot bypass billing with onboarding flags', () => {
  assert.equal(subscriptionAccess({ billing_access_mode: 'subscription_required', subscription_status: 'none', onboarding_completed: true, production_ready: true }).allowed, false);
});
