# Controlled live transition

Do not enable real payments merely by merging.
Backend: deploy Organization schema + resolveUserOrganizations + syncBillingSubscription together. Existing test data is retained; new live mapping uses stripe_live_customer_id, stripe_live_subscription_id, live_subscription_status, live_trial_ends_at. Existing app readers of subscription_status MUST be adapted before granting paid entitlements. No RLS strengthening is included here; existing owner-editable billing fields remain a production security blocker for access enforcement.

Base44 secrets: keep STRIPE_SECRET_KEY test for old test calls; add STRIPE_LIVE_SECRET_KEY using protected panel. BILLING_SYNC_LIVE_ENABLED defaults off. Vercel forwards mode explicitly; backend retrieves corresponding Stripe subscription itself, verifies livemode/org metadata and refuses mapping conflicts. No change to DemoTrial/Gmail/Google authorization.

Vercel Production: STRIPE_MODE=live; STRIPE_LIVE_PAYMENTS_ENABLED=true only after backend configured; real STRIPE_SECRET_KEY, STRIPE_PRICE_OWNER_OP/FLEET and STRIPE_WEBHOOK_SECRET. Preview stays mode=test with original test credentials. Separate destination in Stripe live mode with same webhook route. All actual secrets are set via protected UI, never repository/chat.

Do not delete Redis test records. Live uses separate namespaces. Old production test events must continue targeting a deployment configured test; live receiver rejects test signatures/modes. Do not mix real and test events on same destination. Disable old test destination or preserve a dedicated test deployment before cutover.

Acceptance pending: live Stripe key/price alignment, valid/invalid webhook signature and mode, schema write/read mapping, duplicate events, payment failure/cancellation and actual app access. Current website still includes test-only notices and must replace them for live using safe mode-aware UI before launch. No production credential/config changes performed in this PR. Live creation/resolve quotas and full tenant RLS/access enforcement remain review items.

## Native application billing check
getLiveBillingAccess authenticates native Base44 user, requires a server-bound OrganizationMember.base44_user_id and reads canonical subscription directly from Stripe. Default OFF BILLING_LIVE_ACCESS_CHECK_ENABLED. Never grants from user-editable subscription_status alone. Tests cover mode/org/customer/status mismatch.

No native ID bindings are backfilled by this PR. A trusted linking/migration flow must bind Google identity and native account with proof of control; email equality alone is insufficient. Membership RLS still permits ordinary users to create matching-email rows, so base44_user_id field itself is not secure until RLS + onboarding migration are deployed together. Do NOT enable access check or claim production security before that review. Endpoint does not replace checks on each operational API/entity, and UI is not yet wired. Existing users remain unchanged, no wholesale lockout. Paid plan feature limits and past_due grace remain separate pending work. Active is subscription standing, not proof that every historical invoice is paid.
