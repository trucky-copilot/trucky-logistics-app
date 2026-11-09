# updateMany con rol de servicio: prueba sobre una membresía de prueba

## Hallazgos del operador (navegador, sesión admin)
- `filter` con `base44_user_id:null` y con `{$exists:false}` encuentra el campo ausente.
- `updated` cuenta filas MODIFICADAS: un `$set` idéntico devuelve 0.
- `updateMany` desde la sesión del navegador devuelve `success:true, updated:0` incluso sin condiciones null (no escribe: permisos/RLS). La semántica debe verificarse con rol de servicio.

## Cambio en `enrollExistingBillingOrganization` (execute)
`memberWrite.ts` (copia idéntica en `probeMembershipUpdateMany`) fija AMBOS identificadores al estado exacto leído:
ausente → `{$exists:false}`, null explícito → `null`, valor → ese valor exacto; además `id`, `organization_id`, `role:'owner'`, `active:true`.
Nunca lectura previa + escritura incondicional. Como `updated` cuenta modificaciones, el resultado se confirma con una lectura fresca:
- `updated:1` + lectura exacta del objetivo → escrito;
- `updated:0` + lectura exacta del objetivo → repetición idempotente (p. ej. miembro ya vinculado por la fase 1);
- cualquier otra cosa (otra identidad, cambio concurrente, respuesta desconocida) → `EXISTING_ENROLLMENT_REQUIRES_REVIEW`, sin sobrescribir ni registrar.

## Función temporal `probeMembershipUpdateMany`
Rol de servicio, una sola membresía de PRUEBA configurada en el servidor. Solo escribe `base44_user_id` con valores `probe-*`; `google_sub` solo se usa como condición y nunca se escribe. Restaura `base44_user_id` ausente al final. El informe contiene códigos, conteos y etiquetas, nunca identificadores reales.

Variables (apagada por defecto):
- `MEMBERSHIP_UPDATE_PROBE_ENABLED=true` solo durante la prueba.
- `MEMBERSHIP_UPDATE_PROBE_ADMIN_IDS` — admin(es) autorizados (rol admin + lista).
- `MEMBERSHIP_UPDATE_PROBE_MEMBER_ID`, `MEMBERSHIP_UPDATE_PROBE_ORG_ID` — la membresía de prueba.
Rechaza miembros/orgs del piloto (`BILLING_LINK_PILOT_*`), organizaciones registradas y membresías con `base44_user_id` ya presente.

Llamada: POST con sesión admin, body `{"confirm":"PROBE <member-id>"}`.

Pasos y resultado esperado:
1. `absent_matches_exists_false`: ausente + `{$exists:false}` → updated 1.
2. `identical_repeat_idempotent_by_verified_read`: mismo valor → updated 0 y lectura = objetivo.
3. `wrong_value_rejected`: valor distinto exigido → updated 0, sin cambio.
4. `other_identity_rejected`: otro `google_sub` → updated 0, sin cambio.
5. `set_explicit_null`: guarda null (se informa `nullStoredAs`).
6. `exists_false_on_null_informational`: se informa `existsFalseMatchesNull`.
7. `null_matches_null`: null explícito + condición null → updated 1.
8. `concurrent_writer` + `stale_condition_rejected`: otro escritor cambia el valor; la condición vieja → updated 0, sin sobrescribir.
Final: `restored:true`, `googleSubUnchanged:true`, `PROBE_PASSED`. Si algo no coincide → `PROBE_FAILED` con el paso exacto; NO encender `BILLING_EXISTING_ENROLLMENT_ENABLED`.

Después: `MEMBERSHIP_UPDATE_PROBE_ENABLED=false`. La función puede retirarse en un PR posterior.
