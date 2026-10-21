# Stripe webhook — test-only, gated

New function: stripeWebhook. Intended route after Base44 deploy:
`https://trucky-17a283d5.base44.app/api/functions/stripeWebhook`.
This route is NOT verified deployed. Do not treat this document as deployment confirmation.

## Secrets in Base44
STRIPE_SECRET_KEY (same test account as checkout), STRIPE_WEBHOOK_SECRET (the destination's whsec signing secret), CHECKOUT_REDIS_REST_URL and CHECKOUT_REDIS_REST_TOKEN (Upstash server credentials; no browser/public prefixes). Never put values in GitHub/chat.

Register Snapshot events: customer.subscription.created/updated/deleted/trial_will_end, invoice.paid/payment_failed, checkout.session.completed/expired. Configure the destination API version to match the installed Stripe SDK and test both invoice schemas. Stripe authenticates through Stripe-Signature, NOT TRUCKY_SERVER_SECRET. This function uses the Base44 service role; no end-user login is required.

Keep STRIPE_WEBHOOK_TEST_ENABLED unset until RLS and access enforcement are audited. Valid handled events then return 503 intentionally (Stripe retries); invalid signatures return 400. Test on a separate account/organization, not production customers.

## Behavior
Verify raw-body signature, reject live events, resolve org metadata from Stripe, serialize per org using atomic Redis SET NX, retrieve canonical subscription again inside lock, enforce existing customer/subscription mapping, save real status/trial end. Persist event completion only after DB write; retry duplicate successes returns 200. No browser redirect grants access. Expired sessions do not unlock checkout automatically. Billing synchronization does not itself implement application-route entitlement checks.

No lock TTL: crash or uncertain DB write leaves persistent lock for operator reconciliation. Do NOT blindly delete it: confirm old invocation terminated, retrieve canonical Stripe subscription, reconcile DB then remove matching owner only. Storage event records currently have no automatic retention policy.

## Before enabling
- Organization RLS currently lets creators update their organization, including billing fields. OrganizationMember creation currently trusts matching email and accepts role/sub fields. These policies must be secured without breaking existing app onboarding. The webhook cannot compensate for client-writable billing/role fields.
- All other billing writers (legacy reserve function) must be disabled or coordinated; otherwise this lock does not serialize them.
- Add/verify actual application entitlement checks for trialing/active, policy for past_due and canceled subscriptions. Do not set organization active=false automatically: that flag also affects management access.
- Live Redis/Lua acceptance, valid/invalid signature, repeated/concurrent/reordered events, Stripe errors and DB timeout/crash recovery must be tested.
- Organization creation is still two nontransactional writes and needs recovery tests.

No claims of deployed or end-to-end verified status are made by this PR.

## RLS migration in this PR
Organization and OrganizationMember direct create/update/delete are now restricted to Base44 app admins. Service-role backend writes remain available. This closes ordinary-user billing updates and arbitrary owner membership creation. Read rules are unchanged. Platform app admins remain trusted.

Native onboarding now calls ensureOwnOrganization with the Base44 session; the server derives owner email from auth.me(), accepts only a bounded company name, sets setup/none (never production readiness or paid access), and repairs missing owner membership after partial failure. It does not attach Google sub by email. This is not transactional company creation; concurrent native onboarding calls can still duplicate organizations, but cannot start a paid subscription. This remains a staging blocker for a fully automatic production onboarding flow.

Deploy ensureOwnOrganization, updated Onboarding frontend and RLS together in a staging app first. Verify ordinary owner cannot directly update Organization subscription_status, stripe IDs or create OrganizationMember role=owner/admin; verify server onboarding still works. Existing admin-only management tools may require additional server endpoints. Do not blindly publish RLS alone, as old frontend direct writes will be rejected. Do not enable paid entitlement until every protected backend operation checks membership and canonical billing access.
