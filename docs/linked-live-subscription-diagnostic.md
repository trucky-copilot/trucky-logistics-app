# Phase 2: read-only linked live subscription diagnostic

Based on main 91b30d336ed55dba06c508e48fb9fa56ad7b7fab. No UI gate, access restriction, invoice write, migration, charge, checkout or subscription mutation. This patch does not enable real payments.

Operator reviews and opens a separate PR; do not merge the old live-stripe-mode branch wholesale. Function and its three local helpers must be packaged together. Initial flag BILLING_SUBSCRIPTION_CHECK_ENABLED=false. Tests with injected I/O verify logic, not Base44 Cloud/Stripe key permissions. No cloud call has been run by the Agent.

## Configuration
Existing BILLING_LINK_PILOT_ORG_IDS and BILLING_LINK_PILOT_MEMBER_IDS constrain both authenticated queries and results. Use the verified phase-1 pilot, never wildcard. Uses existing Stripe live key and two exact live price IDs only if a live subscription is already recorded. Does not need new secret credentials. Keep STRIPE_MODE=test, LIVE payment/sync/enforcement flags OFF during this diagnostic. Only diagnostic flag may temporarily be true after operator review.

## Contract
POST /api/functions/checkLinkedLiveSubscription
Authenticate with the native Base44 SDK session, not TRUCKY_SERVER_SECRET or Google token. Example inside authenticated app: base44.functions.invoke('checkLinkedLiveSubscription',{organization_id:'<pilot org id>'}). No tokens via chat or console output.

- 503 CHECK_NOT_ENABLED: default, no reads or writes.
- 401 NATIVE_SESSION_REQUIRED; 400 INVALID_REQUEST; 403 PILOT_NOT_ALLOWED/IDENTITY_NOT_LINKED/VERIFIED_MEMBERSHIP_REQUIRED.
- 409 IDENTITY_REQUIRES_REVIEW: inconsistent bidirectional mapping; do not delete it.
- 200 LIVE_SUBSCRIPTION_NOT_RECORDED: verified linked membership, but no separate live subscription recorded. This is an expected blocker, not successful paid access. Never falls back to existing test fields.
- 200 LIVE_SUBSCRIPTION_INSPECTED: plan owner_op/fleet, truthful Stripe status and has_trial. ALL responses include enforced:false; this endpoint never grants or revokes access. active is not an independent invoice-paid receipt.
- Other controlled errors identify unavailable org, mismatched IDs/mode/customer/metadata, bad prices or review-required network outcome. No personal data or credentials logged.

Expected distinct fields for future live sync: Organization.stripe_live_subscription_id and Organization.stripe_live_customer_id. Current main schema and syncBillingSubscription are test-only. Do not insert real/test IDs manually to make this check pass. A separate reviewed live-sync/schema change is still required before recording actual live purchases. A real charge needs explicit authorization and is NOT part of this test.

## Acceptance
Operator publishes function initially off, tests 503 without reads. Turns on only diagnostic flag with exact pilot lists, invokes once from verified pilot native session. Verify no changes to org, membership, Redis, trial or permissions. Expect LIVE_SUBSCRIPTION_NOT_RECORDED for a tenant with only historical test purchases. Turn diagnostic off after testing. This outcome validates native identity/provenance reads but NOT successful live subscription reconciliation or operational access controls.

## Procedimiento de publicación y prueba (operador)

Variables durante toda la prueba: `STRIPE_MODE=test`; LIVE, `BILLING_SYNC_LIVE_ENABLED`, `BILLING_LIVE_ACCESS_CHECK_ENABLED` y `BILLING_LIVE_ENFORCEMENT_ENABLED` **apagados**. No crear ni editar `stripe_live_subscription_id` / `stripe_live_customer_id` a mano, ni copiar IDs de pruebas (`stripe_subscription_id`, `stripe_customer_id`) a campos live.

1. Fusionar la PR y publicar en Base44 la función `checkLinkedLiveSubscription` con sus 4 archivos: `entry.ts`, `check.ts`, `provenance.ts`, `demoRegistry.ts`.
2. **Con el indicador apagado** (`BILLING_SUBSCRIPTION_CHECK_ENABLED` ausente o `false`), desde la app con sesión nativa:
   ```js
   const { base44 } = await import('/src/api/base44Client.js');
   const call = (fn, body) => base44.functions.invoke(fn, body).then(r => r.data).catch(e => e.response?.data);
   await call('checkLinkedLiveSubscription', { organization_id: '6aac0718ff3a5154cb00ddb1' });
   ```
   Esperado: `{ code: 'CHECK_NOT_ENABLED', enforced: false }` (503, sin lecturas).
3. Activar **solo** `BILLING_SUBSCRIPTION_CHECK_ENABLED=true` (las listas del piloto ya existen: `BILLING_LINK_PILOT_ORG_IDS=6aac0718ff3a5154cb00ddb1`, `BILLING_LINK_PILOT_MEMBER_IDS=6aac0719be8a03dcc9d4562a`).
4. Desde la sesión nativa vinculada de Testing-Pro (usuario `6aaadb6424f21c6bec289a32`), una sola vez:
   ```js
   await call('checkLinkedLiveSubscription', { organization_id: '6aac0718ff3a5154cb00ddb1' });
   ```
   Esperado: `{ code: 'LIVE_SUBSCRIPTION_NOT_RECORDED', enforced: false }` (no hay suscripción live registrada; los campos de prueba no se usan).
   Controles opcionales sin efectos: otra org → `PILOT_NOT_ALLOWED`; un campo extra (`subscription_id`) → `INVALID_REQUEST`; sesión no vinculada → `IDENTITY_NOT_LINKED`.
5. Verificar que no cambió nada: membresía (`base44_user_id`, rol, activa), organización, claves Redis de vínculo/procedencia, trial y permisos.
6. Volver a apagar `BILLING_SUBSCRIPTION_CHECK_ENABLED`.

Este resultado valida la lectura de identidad nativa y procedencia, **no** la conciliación de una suscripción live ni el control de acceso.
