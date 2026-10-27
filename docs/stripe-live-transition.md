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

## Dual-proof linking endpoint (prepared, not enabled)
linkBillingIdentity requires native auth.me() session AND valid Google ID token (audience/issuer/expiration/verified email) and an established Google-sub membership. Matching email is only a cross-check after both identities are authenticated; no email-only migration. Existing other native bindings are rejected. BILLING_IDENTITY_LINK_ENABLED default OFF; client may never set native user ID.

This endpoint needs an app-side OAuth ID-token acquisition/secure handoff; do NOT put tokens into URL/localStorage or use website cookies across domains. That handoff is not implemented. RLS must prohibit ordinary membership writes before enabling this function (existing email-based create policy remains a blocker). Concurrent conflicting links need conditional binding/atomic coordinator before enabling; this implementation does not claim that guarantee. No production binding or user migration performed.

## Stage credentials without enabling charges
Safe to ADD (not replace) STRIPE_LIVE_SECRET_KEY, STRIPE_LIVE_PRICE_OWNER_OP, STRIPE_LIVE_PRICE_FLEET and STRIPE_LIVE_WEBHOOK_SECRET in Vercel Production. Add STRIPE_LIVE_SECRET_KEY in Base44. Keep all live enable flags false and STRIPE_MODE=test until actual acceptance. Existing test configuration continues unchanged.

checkLiveBillingConfiguration uses S2S auth, reads prices through live Stripe key and verifies exact 29/99 USD monthly settings; performs no Stripe writes/charges. Website live checkout requires this check before session creation. This only validates configuration, not app access, RLS or schema migration. Backend function must be published before enabling live. New staged variable names prevent accidentally breaking test mode while preparing credentials.

## Exact price allowlist
Base44 sync and live access additionally require STRIPE_LIVE_PRICE_OWNER_OP and STRIPE_LIVE_PRICE_FLEET. Use the same real price IDs as Vercel. Matching currency/amount alone is insufficient. Missing or identical IDs fail closed; no automatic configuration or real charge performed. Live access response includes plan code only after canonical subscription/mapping verification. Operational entitlement enforcement and native linking remain gated pending work.

## Atomic identity-binding registry
linkBillingIdentity now reserves Google subject -> native Base44 user ID atomically via Redis SET NX with no TTL. Same identity retries are allowed; competing identities rejected. getLiveBillingAccess additionally verifies this server-owned registry instead of trusting native ID fields alone. Do not delete identity registry entries casually; uncertain writes require operator review. Public native-Google handoff and trusted origin/provenance of memberships remain pending. This does NOT make client-creatable OrganizationMember rows safe; RLS/onboarding restrictions are still mandatory before enable. No production bindings created.

## Server provenance for billing memberships
New public memberships can mint Redis proof only immediately following server creation with BILLING_MEMBERSHIP_PROVENANCE_ENABLED=true. Proof binds exact membership ID, Google subject, org and role. Native linking/access require it in addition to dual identity and atomic binding. Ordinary client-created rows and role edits lack matching proof. Do not automatically mint proof for legacy rows by matching email or existing roles. Existing users stay on unchanged flow until explicit migration; their access is not revoked by these disabled functions.

Creation remains two DB writes plus Redis; a partially failed proof requires reconciliation, not automatic new organization. Native login/Google handoff UI is not wired; these checks remain disabled and are not end-to-end operational. Global RLS and direct-entity access still need review; proof secures these new billing endpoints, not all application resources. Do not enable flags or launch payments until operational enforcement and handoff are completed and tested. No production changes in this commit.

## Browser handoff implementation (gated, acceptance pending)
Website /billing-link lets authenticated Google owner/admin choose organization and emits random 256-bit code expiring in 5 minutes. Only SHA-256 hash is Redis key; payload stores sub/email/org, not OAuth tokens. Fixed Base44 destination receives code in fragment; new app component clears fragment immediately, requires native auth.me session and explicit confirmation before POST redeemBillingLink. Redeem checks native email match to ticket (dual sessions), exact server membership provenance and atomic identity binding. GETDEL prevents replay; failures require a new ticket, not deletion of identity registry. No bearer code persisted in browser storage or logs.

Requires BILLING_IDENTITY_LINK_ENABLED in both servers; default off. Existing app sessions untouched unless a billing_link fragment is present. Native sign-in can discard an unconsumed fragment, in which case user must sign in first then issue fresh link. Test these actual platform semantics before enabling. Email match is cross-check, never substitute for ticket/native proof. Existing multiple-company selection/access enforcement remain separate. Handoff does not itself grant paid features. No global entitlement enforcement/legacy migration deployed by this work.
