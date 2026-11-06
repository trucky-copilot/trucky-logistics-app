/**
 * Migración ÚNICA de la prueba de procedencia de la membresía legacy de
 * Testing-Pro. Lógica pura: toda E/S llega inyectada (deps) para probarla
 * sin red, sin Redis y sin Base44. Contrato: docs/legacy-provenance-migration.md
 *
 * Flujo en dos pasos (ningún token pasa por personas):
 *  1. owner_approval — SOLO servidor-a-servidor (backend de la landing, con
 *     TRUCKY_SERVER_SECRET). Trae el ID token Google reciente del titular y su
 *     consentimiento. Se verifica y se guarda una APROBACIÓN temporal ligada a
 *     la identidad y la membresía verificadas. El token NO se guarda.
 *  2. preview / execute — el administrador con SU propia sesión Base44.
 *     preview no escribe; execute exige confirmación, CONSUME la aprobación
 *     (una sola vez) y escribe la prueba con SET NX.
 *
 * Nunca se vincula por correo (solo verificación cruzada), nunca se asigna
 * google_sub, no se toca base44_user_id ni se quita ninguna validación.
 */
import { assertMembershipProvenance, provenanceKey } from './provenance.ts';

export const TARGET_ORG_ID = '6aac0718ff3a5154cb00ddb1';
export const TARGET_MEMBER_ID = '6aac0719be8a03dcc9d4562a';
export const CONFIRMATION_PHRASE = `MIGRATE ${TARGET_MEMBER_ID}`;
const NS = 'trucky:billing:migration:legacy-provenance:v1';
export const APPROVAL_KEY = `${NS}:approval:${TARGET_MEMBER_ID}`;
export const DONE_KEY = `${NS}:done:${TARGET_MEMBER_ID}`;
export const AUDIT_KEY = `${NS}:audit`;
/** Antigüedad máxima del ID token (desde `iat`). */
export const MAX_TOKEN_AGE_SECONDS = 600;
/** Vigencia de la aprobación del titular. */
export const APPROVAL_TTL_SECONDS = 900;

export type RedisCommand = (command: unknown[]) => Promise<unknown>;

export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  email_verified: boolean;
  iat: number;
}

export interface MigrationDeps {
  enabled: boolean;
  allowedAdminIds: Set<string>;
  /** true solo si la petición trae el secreto servidor-a-servidor correcto. */
  isTrustedServer: () => boolean;
  getCaller: () => Promise<{ id?: string; role?: string } | null>;
  verifyGoogleIdToken: (token: string) => Promise<VerifiedGoogleIdentity | null>;
  getMember: (id: string) => Promise<any | null>;
  getOrganization: (id: string) => Promise<any | null>;
  listActiveOwners: (orgId: string) => Promise<any[]>;
  redis: RedisCommand;
  now: () => number; // ms
  newId: () => string;
}

export interface MigrationResult {
  status: number;
  code: string;
  mode?: string;
  checks?: Record<string, boolean>;
  wouldWrite?: boolean;
  approvalExpiresAt?: string;
}

const reply = (status: number, code: string, extra: Partial<MigrationResult> = {}): MigrationResult =>
  ({ status, code, ...extra });

export function expectedProvenance(member: { id: string; organization_id: string; google_sub: string; role: string }) {
  // Mismo orden de campos que createOrganizationForUser (rama live-stripe-mode).
  return JSON.stringify({ memberId: member.id, orgId: member.organization_id, googleSub: member.google_sub, role: member.role });
}

/** Verificaciones de membresía/organización contra un `sub` ya verificado. */
async function checkOwnership(deps: MigrationDeps, sub: string, email: string | null) {
  const member = await deps.getMember(TARGET_MEMBER_ID);
  const org = await deps.getOrganization(TARGET_ORG_ID);
  const owners = await deps.listActiveOwners(TARGET_ORG_ID);
  const checks: Record<string, boolean> = {
    member_exists: !!member,
    member_in_target_org: member?.organization_id === TARGET_ORG_ID,
    member_is_active_owner: member?.active === true && member?.role === 'owner',
    member_has_google_sub: typeof member?.google_sub === 'string' && member.google_sub.length > 0,
    verified_sub_matches_member: !!member && member.google_sub === sub,
    org_exists_and_active: !!org && org.active !== false,
    single_active_owner_is_member: owners.length === 1 && owners[0]?.id === TARGET_MEMBER_ID,
    org_creator_is_member: !!org && !!member &&
      String(org.created_by_user || '').toLowerCase() === String(member.user_email || '').toLowerCase(),
  };
  // Verificación CRUZADA (no es la base del vínculo). Solo cuando hay token.
  if (email !== null) {
    checks.token_email_cross_check = !!member && email.toLowerCase() === String(member.user_email || '').toLowerCase();
  }
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  return { member, checks, failed };
}

const targetMatches = (body: any) => body?.organization_id === TARGET_ORG_ID && body?.member_id === TARGET_MEMBER_ID;

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1: aprobación del titular (servidor-a-servidor)
// ─────────────────────────────────────────────────────────────────────────────
export async function runOwnerApproval(body: any, deps: MigrationDeps): Promise<MigrationResult> {
  const mode = 'owner_approval';
  if (!deps.enabled) return reply(503, 'MIGRATION_DISABLED');
  if (!deps.isTrustedServer()) return reply(401, 'SERVER_AUTH_REQUIRED');
  if (await deps.redis(['GET', DONE_KEY])) return reply(410, 'MIGRATION_ALREADY_COMPLETED');
  if (!targetMatches(body)) return reply(403, 'TARGET_NOT_ALLOWED');
  if (body.owner_consent !== true) return reply(400, 'OWNER_CONSENT_REQUIRED');
  if (typeof body.google_id_token !== 'string' || body.google_id_token.length === 0 || body.google_id_token.length > 4096) {
    return reply(400, 'GOOGLE_ID_TOKEN_REQUIRED');
  }

  const identity = await deps.verifyGoogleIdToken(body.google_id_token).catch(() => null);
  if (!identity || identity.email_verified !== true || !identity.sub) return reply(401, 'GOOGLE_AUTHORIZATION_REQUIRED');
  const ageSeconds = deps.now() / 1000 - identity.iat;
  if (!(ageSeconds >= -60 && ageSeconds <= MAX_TOKEN_AGE_SECONDS)) return reply(401, 'GOOGLE_TOKEN_NOT_RECENT');

  const { checks, failed } = await checkOwnership(deps, identity.sub, identity.email);
  if (failed.length > 0) return reply(409, `CHECK_FAILED:${failed.join(',')}`, { mode, checks });

  // Aprobación ligada a identidad + membresía verificadas. SIN token.
  const approvedAt = new Date(deps.now()).toISOString();
  const approval = { approvalId: deps.newId(), orgId: TARGET_ORG_ID, memberId: TARGET_MEMBER_ID, googleSub: identity.sub, approvedAt };
  const set = await deps.redis(['SET', APPROVAL_KEY, JSON.stringify(approval), 'EX', APPROVAL_TTL_SECONDS, 'NX']);
  if (set !== 'OK') return reply(409, 'APPROVAL_ALREADY_PENDING', { mode });

  await deps.redis(['RPUSH', AUDIT_KEY, JSON.stringify({ at: approvedAt, event: 'owner_approval', approvalId: approval.approvalId, orgId: TARGET_ORG_ID, memberId: TARGET_MEMBER_ID, googleSub: identity.sub })]);
  return reply(200, 'OWNER_APPROVAL_RECORDED', {
    mode, checks, approvalExpiresAt: new Date(deps.now() + APPROVAL_TTL_SECONDS * 1000).toISOString(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2: revisión y ejecución del administrador (su propia sesión)
// ─────────────────────────────────────────────────────────────────────────────
export async function runAdminMigration(body: any, deps: MigrationDeps): Promise<MigrationResult> {
  if (!deps.enabled) return reply(503, 'MIGRATION_DISABLED');

  const caller = await deps.getCaller().catch(() => null);
  if (!caller?.id) return reply(401, 'ADMIN_SESSION_REQUIRED');
  if (caller.role !== 'admin' || !deps.allowedAdminIds.has(caller.id)) return reply(403, 'ADMIN_NOT_AUTHORIZED');
  if (await deps.redis(['GET', DONE_KEY])) return reply(410, 'MIGRATION_ALREADY_COMPLETED');

  const mode = body?.mode;
  if (mode !== 'preview' && mode !== 'execute') return reply(400, 'INVALID_MODE');
  if (!targetMatches(body)) return reply(403, 'TARGET_NOT_ALLOWED');
  if ('google_id_token' in (body ?? {})) return reply(400, 'TOKEN_NOT_ACCEPTED_FROM_ADMIN');

  // Aprobación vigente del titular (la vigencia la da el TTL de Redis).
  const rawApproval = await deps.redis(['GET', APPROVAL_KEY]);
  if (!rawApproval) return reply(409, 'OWNER_APPROVAL_REQUIRED', { mode });
  let approval: any;
  try { approval = JSON.parse(String(rawApproval)); } catch { return reply(409, 'OWNER_APPROVAL_INVALID', { mode }); }
  if (approval.orgId !== TARGET_ORG_ID || approval.memberId !== TARGET_MEMBER_ID || typeof approval.googleSub !== 'string') {
    return reply(409, 'OWNER_APPROVAL_INVALID', { mode });
  }

  const { member, checks, failed } = await checkOwnership(deps, approval.googleSub, null);
  if (failed.length > 0) return reply(409, `CHECK_FAILED:${failed.join(',')}`, { mode, checks });

  const key = provenanceKey(TARGET_ORG_ID, member.google_sub);
  const current = await deps.redis(['GET', key]);
  if (current != null) {
    try { await assertMembershipProvenance(deps.redis, member); }
    catch { return reply(409, 'PROVENANCE_CONFLICT', { mode, checks, wouldWrite: false }); }
  }
  if (mode === 'preview') return reply(200, current != null ? 'ALREADY_PRESENT' : 'READY', { mode, checks, wouldWrite: current == null });

  if (body.confirm !== CONFIRMATION_PHRASE) return reply(400, 'CONFIRMATION_REQUIRED', { mode, checks });

  // Consumir la aprobación UNA sola vez, y que sea exactamente la revisada.
  const consumed = await deps.redis(['GETDEL', APPROVAL_KEY]);
  if (consumed == null || String(consumed) !== String(rawApproval)) return reply(409, 'OWNER_APPROVAL_CHANGED', { mode });

  let outcome = 'ALREADY_PRESENT';
  if (current == null) {
    const set = await deps.redis(['SET', key, expectedProvenance(member), 'NX']);
    if (set !== 'OK') {
      try { await assertMembershipProvenance(deps.redis, member); }
      catch { return reply(409, 'PROVENANCE_CONFLICT', { mode, checks, wouldWrite: false }); }
    } else {
      outcome = 'PROVENANCE_WRITTEN';
    }
  }
  await assertMembershipProvenance(deps.redis, member);

  const at = new Date(deps.now()).toISOString();
  await deps.redis(['RPUSH', AUDIT_KEY, JSON.stringify({ at, event: 'admin_execute', adminId: caller.id, approvalId: approval.approvalId, orgId: TARGET_ORG_ID, memberId: TARGET_MEMBER_ID, googleSub: member.google_sub, outcome })]);
  await deps.redis(['SET', DONE_KEY, at, 'NX']);
  return reply(200, outcome, { mode, checks, wouldWrite: false });
}

export async function route(body: any, deps: MigrationDeps): Promise<MigrationResult> {
  return body?.mode === 'owner_approval' ? runOwnerApproval(body, deps) : runAdminMigration(body, deps);
}
