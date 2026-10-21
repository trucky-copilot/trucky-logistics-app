# Isolated Stripe webhook test deployment

This PR contains ONLY billingWebhook and tests. No entity schema, RLS, onboarding or current app access changes. It does not enable checkout or claim production access security.

## Base44 deployment
Merge this PR, synchronize it into Base44, and publish the billingWebhook function. Leave STRIPE_WEBHOOK_TEST_ENABLED unset. No billing mutation occurs while disabled. Intended route (verify deployment before registration):
https://trucky-17a283d5.base44.app/api/functions/billingWebhook

## Protected secrets (never put values in chat or Git)
- STRIPE_SECRET_KEY: same test Stripe account as web checkout.
- STRIPE_WEBHOOK_SECRET: destination signing secret generated after registering URL in Stripe.
- CHECKOUT_REDIS_REST_URL / CHECKOUT_REDIS_REST_TOKEN: Upstash REST server credentials from the existing test Redis resource. Base44 does not automatically inherit Vercel env variables.
- STRIPE_TEST_ORGANIZATION_IDS: comma-separated IDs of dedicated disposable test organizations ONLY; never existing customer companies.
- STRIPE_WEBHOOK_TEST_ENABLED: leave unset initially. Later true only for controlled acceptance.

## Stripe destination
Sandbox/test mode, Your account, Snapshot events:
customer.subscription.created, customer.subscription.updated, customer.subscription.deleted,
customer.subscription.trial_will_end, invoice.paid, invoice.payment_failed,
checkout.session.completed, checkout.session.expired.

Initial signed recognized events intentionally return 503 until enabled; Stripe retries. Unsigned calls return 400. Other organizations return 403 after flag enabled. Expired sessions without subscription are acknowledged without granting access. No global production entitlement restriction is activated.

## Before controlled checkout
Website test checkout must restrict organization IDs server-side too. Verify auth/owner/admin roles against test fixtures and reject everyone else. Never enable global checkout solely because webhook responds 200.

## Limits
Actual Redis, Stripe and Base44 execution remains to be verified after publication. Test organization IDs must not be user-editable. Existing Organization RLS permits creator edits of billing fields; global security hardening remains separate draft PR #15. This isolated function is not a production launch and does not enforce app entitlements or provide SSO. Subscription mapping conflicts fail closed; uncertainty retains Redis lock for manual reconciliation. Do not delete locks blindly. No production domain changes.


## Route migration
The old stripeWebhook function is removed from source; verify whether Base44 removes the old deployed route or requires manual removal. Publish billingWebhook first, then edit the EXISTING Stripe test destination URL to /api/functions/billingWebhook. Retain its signing secret if Stripe keeps the same destination; if Stripe issues a replacement, update the protected secret accordingly. Do not create another subscription or disable signature verification. Keep STRIPE_WEBHOOK_TEST_ENABLED=false while checking routing: signed supported events should return our 503 PROVISIONING_NOT_ENABLED, not a platform 401. Only after controlled configuration acceptance enable and resend existing failed events.

The claimed reserved-name behavior is a developer-reported hypothesis; success must be confirmed in actual gateway/runtime logs. No production access changes.
