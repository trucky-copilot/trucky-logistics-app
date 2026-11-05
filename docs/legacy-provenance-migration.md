# Migración única: prueba de procedencia de la membresía legacy de Testing-Pro

Función: `base44/functions/migrateLegacyMembershipProvenance` (lógica en `migration.ts`, pruebas en `migration_test.ts`).
Alcance fijo: organización `6aac0718ff3a5154cb00ddb1`, membresía `6aac0719be8a03dcc9d4562a`.
No toca `base44_user_id`, no asigna `google_sub`, no quita validaciones y no cambia indicadores LIVE.
**Ningún token pasa por personas** (chat, correo, URL, capturas o logs): el ID token solo viaja servidor-a-servidor y no se guarda.

## Configuración del servidor (Base44)

| Variable | Valor |
|---|---|
| `LEGACY_PROVENANCE_MIGRATION_ENABLED` | `true` solo durante la migración; quitarla al terminar |
| `LEGACY_PROVENANCE_MIGRATION_ADMIN_IDS` | ID(s) de usuario Base44 de los administradores autorizados |
| `TRUCKY_SERVER_SECRET` | ya existente (llamada de la landing) |
| `GOOGLE_CLIENT_ID`, `CHECKOUT_REDIS_REST_URL`, `CHECKOUT_REDIS_REST_TOKEN` | ya existentes |

## Paso 1 — Aprobación del titular (servidor-a-servidor)

El titular vuelve a iniciar sesión con Google en la landing y confirma su consentimiento. El backend de la landing llama:

`POST` · `Authorization: Bearer <TRUCKY_SERVER_SECRET>`
```json
{ "mode": "owner_approval", "organization_id": "6aac0718ff3a5154cb00ddb1",
  "member_id": "6aac0719be8a03dcc9d4562a", "google_id_token": "<de la sesión protegida>", "owner_consent": true }
```
Se verifica: secreto S2S; ID token con firma RS256 contra el JWKS de Google, emisor, audiencia `GOOGLE_CLIENT_ID`, expiración, `email_verified` e `iat` ≤ 10 min; membresía `owner` activa de esa org con `google_sub === sub`; única propietaria activa; `created_by_user` = titular; correo solo como verificación cruzada.

Resultado: aprobación en `…:approval:<memberId>` con `{approvalId, orgId, memberId, googleSub, approvedAt}` — **sin token** —, vence en 15 min (`EX 900`, `NX`). Respuesta `OWNER_APPROVAL_RECORDED` + `approvalExpiresAt`.

## Paso 2 — Administrador (su propia sesión Base44)

`POST` con sesión de un admin (rol `admin` **y** en `LEGACY_PROVENANCE_MIGRATION_ADMIN_IDS`). Nunca acepta tokens (`TOKEN_NOT_ACCEPTED_FROM_ADMIN`).
```json
{ "mode": "preview" | "execute", "organization_id": "6aac0718ff3a5154cb00ddb1",
  "member_id": "6aac0719be8a03dcc9d4562a", "confirm": "MIGRATE 6aac0719be8a03dcc9d4562a" }
```
- Exige aprobación vigente; revalida la membresía contra el `sub` aprobado.
- `preview`: sin escrituras y sin consumir la aprobación → `READY` / `ALREADY_PRESENT` + `checks`.
- `execute` (frase exacta): consume la aprobación con `GETDEL` (una sola vez y debe ser la misma revisada) → `SET NX` de `trucky:billing:member:v1:<orgId>:<sub>` con `{memberId, orgId, googleSub, role}` (formato de `assertMembershipProvenance`) → revalida con ese validador.
  - Existe y coincide → `ALREADY_PRESENT`. Difiere o pierde una carrera → `PROVENANCE_CONFLICT`, sin sobrescribir.
- Auditoría en `…:audit` (aprobación y ejecución, sin tokens). Marca `…:done:<memberId>`: toda llamada posterior → `MIGRATION_ALREADY_COMPLETED`.

## Respuestas principales

| HTTP | `code` |
|---|---|
| 503 | `MIGRATION_DISABLED`, `MIGRATION_REQUIRES_REVIEW` |
| 401 | `SERVER_AUTH_REQUIRED`, `ADMIN_SESSION_REQUIRED`, `GOOGLE_AUTHORIZATION_REQUIRED`, `GOOGLE_TOKEN_NOT_RECENT` |
| 403 | `ADMIN_NOT_AUTHORIZED`, `TARGET_NOT_ALLOWED` |
| 400 | `OWNER_CONSENT_REQUIRED`, `GOOGLE_ID_TOKEN_REQUIRED`, `INVALID_MODE`, `TOKEN_NOT_ACCEPTED_FROM_ADMIN`, `CONFIRMATION_REQUIRED` |
| 409 | `CHECK_FAILED:<lista>`, `APPROVAL_ALREADY_PENDING`, `OWNER_APPROVAL_REQUIRED`, `OWNER_APPROVAL_INVALID`, `OWNER_APPROVAL_CHANGED`, `PROVENANCE_CONFLICT` |
| 410 | `MIGRATION_ALREADY_COMPLETED` |
| 200 | `OWNER_APPROVAL_RECORDED`, `READY`, `ALREADY_PRESENT`, `PROVENANCE_WRITTEN` |

## Procedimiento
1. Publicar en Base44 las reglas de acceso y `ensureUserOrganization`. LIVE apagado.
2. Publicar esta función y configurar variables.
3. Titular: nuevo login Google + consentimiento en la landing → la landing llama `owner_approval`.
4. Admin: `preview` (esperado `READY`) y luego `execute` con la frase, antes de que venza la aprobación.
5. Quitar `LEGACY_PROVENANCE_MIGRATION_ENABLED`.
6. Probar un enlace nuevo → `IDENTITY_LINKED` y acceso a la empresa correcta.

Membresías nuevas de `ensureUserOrganization` (onboarding de la app) quedan fuera de esta migración.
