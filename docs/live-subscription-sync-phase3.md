# Phase 3 — isolated live subscription projection (not paid-access enforcement)

Base: main 2fe2a264f8e74d0b05297c99054ee59d84e933f6. Operator must create a separate reviewed PR from this patch; do NOT merge the historical live-stripe-mode branch wholesale. No frontend or operational access changes. Existing RLS, test billing fields, onboarding and DemoTrial stay intact.

## What changes
Organization adds stripe_live_customer_id, stripe_live_subscription_id, stripe_live_price_id, stripe_live_plan_type (owner_op/fleet), stripe_live_subscription_status. No defaults or backfills. Existing trial_ends_at and all test fields remain untouched. This projection is informational; active does not prove invoice payment and does not grant access.

syncBillingSubscription keeps its authenticated test path and accepts body.mode === 'live' on a separately gated path. Server key is validated before any branch. Unknown modes rejected; missing mode preserves test behavior for existing callers. Native sessions alone cannot invoke this S2S endpoint. Stripe-Signature is checked in the Vercel webhook, not this function; Vercel sends its own authenticated server call and Base44 independently retrieves canonical Stripe state.

## Live contract
POST /api/functions/syncBillingSubscription
Authorization: Bearer <existing TRUCKY_SERVER_SECRET>
Content-Type: application/json
Body: {"mode":"live","organization_id":"<allowed pilot org>","subscription_id":"<existing actual Stripe live subscription>"}

Do not supply status, dates, plan/customer or price from the browser. They are ignored. Do not invent or manually insert IDs to manufacture success. This phase does not authorize creation of a real subscription/payment.

Required config already staged: STRIPE_LIVE_SECRET_KEY (sk_live or rk_live), STRIPE_LIVE_PRICE_OWNER_OP and STRIPE_LIVE_PRICE_FLEET. Pilot lists are the existing BILLING_LINK_PILOT_ORG_IDS and BILLING_LINK_PILOT_MEMBER_IDS from verified phase 1. New switch BILLING_SYNC_LIVE_ENABLED defaults OFF. Existing test switch BILLING_SYNC_TEST_ENABLED remains unchanged. Keep STRIPE_MODE=test, live checkout/webhook and BILLING_LIVE_ENFORCEMENT_ENABLED OFF during staging.

Live checks: exact organization; one listed active owner/admin membership with server provenance and consistent native<->Google binding; exact Stripe live subscription ID, customer and metadata.org_id; exact approved monthly USD 29/99 price, per-unit quantity one, one item and no pagination. No active or future Stripe trial is accepted on paid plans (`status==='trialing'` or `trial_end` in the future → `LIVE_TRIAL_NOT_ALLOWED`); a historical trial that already ended is allowed. New paid plans still carry no free month. Known unpaid/canceled statuses are projected truthfully, never default active. A different previously pinned live subscription/customer requires review, not overwrite.

## Serialization and uncertain writes
A dedicated backend lock trucky:billing:sync:live:org:<org> is acquired with SET NX before org reads and Stripe retrieval. Different from the Vercel webhook lock, avoiding deadlock on a nested request. No TTL: do not auto-release an unknown DB write. Successful update or errors before writing release only their own lock via Lua. Before updating Base44 the function records `trucky:billing:sync:live:pending:org:<org>` = {owner, orgId, subscriptionId, fields, before, startedAt} (no tokens). A successful write releases lock and its own pending record atomically (Lua, owner-checked). A DB write timeout returns LIVE_WRITE_REQUIRES_REVIEW and retains BOTH lock and pending record; live provider/Redis failures can be uncertain, so inspect records before operator recovery. The function does not retry writes. Duplicate completed calls fetch latest state again and set the same isolated fields; no event timestamp overwrites cached state. This is not durable invoice/event history.

## Administrative lock recovery (`recoverLiveSyncLock`)
Never a blind delete. Native Base44 admin session only (role `admin` AND listed in `BILLING_SYNC_RECOVERY_ADMIN_IDS`); switch `BILLING_SYNC_RECOVERY_ENABLED` defaults OFF. Never accepts the S2S secret or tokens, never writes Organization, never retries the sync.
- `{"mode":"preview","organization_id":"<org>"}` → `RECOVERY_PREVIEW` with `owner`, `ageSeconds`, `subscriptionId`, `canRelease` and `outcome`: `NO_WRITE_STARTED` (lock without pending), `WRITE_APPLIED` (current 5 live fields == pending.fields), `WRITE_NOT_APPLIED` (== pending.before), `WRITE_PARTIAL` or `INCONSISTENT`. No writes. `NO_LOCK` if nothing is held.
- `{"mode":"release","organization_id":"<org>","owner":"<owner from preview>","confirm":"RELEASE <org>"}` releases only when: exact confirmation, same owner as reviewed (`OWNER_MISMATCH` otherwise), lock older than 5 minutes so no write can still be in flight (`LOCK_TOO_RECENT`), and outcome determined (`NO_WRITE_STARTED`/`WRITE_APPLIED`/`WRITE_NOT_APPLIED`; partial or inconsistent → `REVIEW_REQUIRED`). Lock + pending are deleted in one owner-checked Lua script (`LOCK_CHANGED` if the owner changed meanwhile) and an audit entry is appended to `trucky:billing:sync:live:recovery:audit` (time, admin, org, owner, outcome, subscription; no tokens or personal data).
- After `WRITE_NOT_APPLIED`, re-run the authenticated live sync; after `WRITE_APPLIED`, the stored state is already correct. Partial/inconsistent states require manual review of the Organization record; do not delete keys.

## Publication and acceptance
1. Review diff against current main; publish Organization schema FIRST, then syncBillingSubscription with entry.ts, gate.ts, live.ts, lock.ts, provenance.ts and existing demoRegistry.ts, and recoverLiveSyncLock with entry.ts, recover.ts, lock.ts and demoRegistry.ts. Leave BILLING_SYNC_LIVE_ENABLED=false and BILLING_SYNC_RECOVERY_ENABLED=false.
2. Confirm (from the landing backend, which holds the secret — never from a browser console or chat) that a live request without/with wrong S2S auth returns 401 UNAUTHORIZED and a correctly authenticated live request with the switch off returns 503 SYNC_NOT_ENABLED; no writes. Both behaviors are covered by tests/billing/live-sync-gate.test.ts. Confirm existing test path still works using authorized test subscriptions (not real payments).
3. Do not enable Vercel live checkout/webhook or payment collection merely because this function is published. Both mode and access acceptance are separate.
4. With operator review, enable ONLY backend live sync and invoke non-pilot/invalid input negatives to verify fail-closed behavior; no synthetic provider IDs in database. For test-mode IDs retrieved with a live key expect a safe provider failure, not success.
5. Successful real-data reconciliation requires an existing actual live subscription authorized for this pilot and legitimate linked checkout. If none exists, stop and report: live success remains unverified. Never create a real charge without explicit user approval. Do not change test metadata/IDs to fake live state.
6. If a legitimate authorized subscription exists, one authenticated call must return 200 {"code":"SUBSCRIPTION_RECONCILED","mode":"live"}; operator reads five live fields, verifies test/demo/RLS unchanged and rechecks read-only checkLinkedLiveSubscription. No UI access enabled by this phase. Turn backend switch OFF after controlled acceptance unless an explicit rollout approves otherwise.

## Remaining dependencies
Current Vercel production must be checked for compatible mode-aware webhook/checkout and origin following domain migration; this patch does not deploy the landing. Paid operational access and preservation of existing-user access must still be reviewed before public collection. Missing live subscription is expected until separately authorized rollout; do not promise the phase-2 diagnostic will become successful immediately.

## Local evidence
Original 13 focused tests plus: trial rule (ended historical trial accepted, future/active rejected), pending-record lifecycle, gate tests for 401 without/with wrong authorization and 503 SYNC_NOT_ENABLED with valid auth and switch off (live and test modes), and 10 recovery tests (authorization, preview without writes, confirmation, owner match, minimum age, applied/not-applied/partial/inconsistent outcomes, atomic owner-checked release, audit, lock changed during release, crashed process without write). Lua release scripts verified against a real Redis server. No Base44/Stripe/Redis cloud writes or charges were executed.
