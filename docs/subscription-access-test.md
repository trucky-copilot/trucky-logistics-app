# Server subscription guard — controlled acceptance only

Default OFF: BILLING_ACCESS_TEST_ENABLED. Test identities are operator-selected in BILLING_ACCESS_TEST_USER_EMAILS (native Base44 session); test tenants are restricted by STRIPE_TEST_ORGANIZATION_IDS. No production user is reclassified and no database migration is performed.

Guards added before operational work in marketChat, analyzeDocument, extractDocumentText, translateChat, syncGmail, sendGmail. Trial end is strictly checked; active permitted; no grace implemented. Multi-membership users require explicit organization_id, not first membership. This is only an acceptance guard: existing functions may derive operational tenant separately, so do not enable general enforcement until tenant binding is reconciled end-to-end.

Native membership still uses authenticated Base44 email; Google/native identity migration and direct-entity RLS are separate pending work. Existing email-based membership creation policy is not secured by this change. Never claim this guard alone prevents all access to unpaid organizations. UserProfile/onboarding frontend access unchanged. Existing users outside test list are untouched.

Copies in each function folder are identical to support independently packaged functions; avoid divergence. Local tests use fake entities, not deployed backend. Parent catch/fallback behavior and each operation need real acceptance. Do not enable in production; keep feature flag unset until review and controlled deployment. Test fixtures must have verified memberships, no customer data and explicit operator authorization.

Production blockers: secure memberships/RLS, trusted migration snapshot for existing users including users without org, tenant-aware UI/backend, automatic classification for new companies, native-Google linking, cancellation/payment grace policy and invoice lifecycle tests. No live payment/domain changes.
