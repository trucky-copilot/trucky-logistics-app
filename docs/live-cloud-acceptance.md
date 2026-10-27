# Cloud acceptance before enabling real payments

Do not merge the full draft solely to run these tests. Deployment order must be reviewed by the Base44 operator; backup app version first. Stage endpoints with flags OFF before frontend; keep existing operational app unchanged initially.

## Negative authentication (safe, no secrets)
`node scripts/billing/check-published-auth.mjs`
Expected 401 UNAUTHORIZED for both endpoints. This intentionally omits bearer authentication. It never prints response bodies or accepts credentials. No account/subscription/database writes.

## Required operator evidence
1. Endpoint getBillingLinkState with enforcement OFF returns enforced:false for current authenticated users; native sessions continue working. New endpoint exists before frontend gate.
2. Link flags OFF return LINK_NOT_ENABLED. With controlled acceptance flags and disposable tenant, issue a 5-minute ticket from website; wrong native account cannot redeem; exact account explicitly confirms; replay/expired tickets rejected. Capture only codes, never ticket/token.
3. Prove untrusted client-created membership cannot satisfy Redis provenance. No writes to customer tenants.
4. Check actual Redis Lua bidirectional binding: conflicting native/Google attempts cannot both win. Model tests do not certify provider runtime.
5. Confirm paid-access query matches org/customer/approved live price. No real charge is necessary for negative cases. Successful live payment acceptance needs explicit operator-authorized purchase/refund policy, not a synthetic charge or test card in live mode.
6. Enforced linked account: canceled/incomplete/test-mode mismatches denied. Existing unlinked users stay unchanged. Multi-tenant cases blocked pending canonical tenant refactor.

## Stop conditions
Unexpected 200 without auth, missing endpoint, native login failure, write outcome unknown or customer access regression: STOP, flags OFF, restore reviewed app version if needed. Never delete identity/checkout locks blindly. Direct entity RLS and operational flows still require full review; these checks alone do not prove global security.

Production remains test mode until operator evidence and remaining access/RLS review are complete. Secrets are already staged; no additional secret is required for this script.
