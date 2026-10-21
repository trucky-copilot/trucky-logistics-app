# Billing release checklist — NOT production-ready

## Completed code
- Website PR #1: Google session, organization UI/API, Redis coordinator, gated test checkout.
- Backend PR #14 (merged): organization functions use established Google sub.
- Backend PR #15 (draft): signed test webhook, RLS write restrictions, native-session onboarding function.

## Newly confirmed access gap
`src/lib/AppStateContext.jsx` currently sets production access from UserProfile.onboarding_completado alone. Organization loading is explicitly non-blocking; subscription_status is not an access control. Changing only this frontend would not secure the APIs.

Protected server functions requiring membership + entitlement audit include marketChat, analyzeDocument, extractDocumentText, translateChat, syncGmail and sendGmail. Several entities are also accessed directly from the client; their RLS must enforce isolation and appropriate authorization. Admin functions need separate platform-admin checks. Do not activate a blanket billing restriction on existing accounts without migration policy and staging acceptance.

## Required design before access enforcement
- Decide migration for current customers without Stripe subscriptions: do not silently lock out existing production users or grant all new users free access.
- Establish verified binding of native Base44 user ID to Google sub used by website. Native auth.me email is not a cross-platform SSO handshake.
- Decide tenant selection for users with multiple memberships; UI and backend must check the same tenant, not arbitrarily use members[0].
- Define past_due grace and cancellation access-through policy. Preserve full advertised trial unless user explicitly ends access.

## Staging deployment (only after draft ready)
1. Isolated Base44 staging app/data; back up policies. Publish updated schema, server functions and frontend together.
2. Test native onboarding; owner cannot directly edit billing or create elevated memberships; platform admins remain trusted.
3. Configure test Stripe and server Redis credentials via protected secrets, then create webhook destination and save its signing secret.
4. Enable test feature flags only after real permissions/entitlements and retry/crash handling are accepted.
5. Test Google -> tenant -> test Checkout -> signed webhook -> protected server operation; cancel, failures, duplicate clicks and out-of-order events.

Do not publish PR #15 to production yet. No claim that end-to-end verification has completed.
