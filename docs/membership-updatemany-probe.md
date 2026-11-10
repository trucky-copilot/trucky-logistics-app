# Service-role updateMany acceptance and retirement

Operator report (2026-11-09): the controlled membership test is complete. Field absent + $exists:false matched; explicit null + null matched; $exists:false did not match explicit null. Wrong exact native/Google values and stale concurrent conditions returned 0 without overwrite. Repeating an identical update with service role returned updated:1: the provider counts matched rows, not only modified rows. Previous browser result updated:0 did not establish service-role semantics. This note records operator evidence, not a new cloud probe by the Agent.

conditionalIdentityWrite keeps exactly the existing runtime behavior: pin id/org/active owner and BOTH identities (absent -> $exists:false, null -> null, populated -> exact); accept counts 0 or 1 only after a fresh exact read verifies all fields. The code comments and mock expectations now reflect actual service-role behavior. Tests cover identical repeats with updated:1 and defensive updated:0, plus changed identities and concurrent writes. Never weaken conditions to a read followed by unconditional update.

## Retired temporary endpoint
The temporary probeMembershipUpdateMany source and its probe-only tests are removed. Keep MEMBERSHIP_UPDATE_PROBE_ENABLED=false until removal is confirmed on Base44. Deleting repository source does NOT prove the platform removed an already deployed function: operator must remove/unpublish the temporary function from Base44, then verify no executable endpoint remains. Do not re-enable it or rerun its write test.

After endpoint retirement, its four variables can be removed from Base44: MEMBERSHIP_UPDATE_PROBE_ENABLED, MEMBERSHIP_UPDATE_PROBE_ADMIN_IDS, MEMBERSHIP_UPDATE_PROBE_MEMBER_ID, MEMBERSHIP_UPDATE_PROBE_ORG_ID. This is a narrow diagnostic retirement, not a blanket environment clean-up. No Redis keys, proof, members, subscriptions or app secrets are deleted by the patch. The controlled membership was already restored according to operator report.

## Next acceptance remains separate
Existing company: new Google approval -> native consent -> administrator preview/execution with independent ownership evidence -> ordinary link IDENTITY_LINKED -> eligibility LIVE_CHECKOUT_ELIGIBLE; same company, no duplicate. No new charge or general rollout authorized by this patch. BILLING_PUBLIC_ENROLLMENT_ENABLED and existing enrollment gate remain OFF until coordinated acceptance and paid operational access TRUCKY-90. No production flag is changed here.
