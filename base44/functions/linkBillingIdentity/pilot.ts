/**
 * Piloto de vinculación (fase 1) y finalización idempotente.
 * Archivo idéntico en redeemBillingLink/ y linkBillingIdentity/ (cada función
 * de Base44 se empaqueta por separado).
 *
 * - El piloto se restringe EN EL BACKEND (no basta la landing): solo las
 *   organizaciones y membresías listadas en el servidor pueden vincularse.
 *   Sin lista configurada, todo se rechaza (falla cerrado).
 * - Si el vínculo atómico en Redis ya quedó guardado pero la escritura en
 *   Base44 falla, NO se borra nada: se reintenta y, si sigue fallando, se
 *   responde LINK_COMPLETION_PENDING para completar luego con `resume`, que
 *   usa como prueba el registro bidireccional de Redis (escrito solo después
 *   de verificar la identidad).
 */
export type RedisCommand = (command: unknown[]) => Promise<unknown>;
export interface LinkResult { status: number; code: string }
export const res = (code: string, status = 200): LinkResult => ({ code, status });

export interface PilotConfig { pilotOrgIds: Set<string>; pilotMemberIds: Set<string> }

export function parseIdList(value: string | undefined | null): Set<string> {
  return new Set((value || '').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{1,128}$/.test(s)));
}

export const pilotConfigured = (p: PilotConfig) => p.pilotOrgIds.size > 0 && p.pilotMemberIds.size > 0;
export const pilotAllowsOrg = (p: PilotConfig, orgId: unknown) => typeof orgId === 'string' && p.pilotOrgIds.has(orgId);
export const pilotAllowsMember = (p: PilotConfig, member: any) =>
  !!member && p.pilotOrgIds.has(member.organization_id) && p.pilotMemberIds.has(member.id);

/** Escribe base44_user_id con reintentos; nunca deshace el vínculo de Redis. */
export async function completeMemberBinding(
  updateMember: (id: string, data: { base44_user_id: string }) => Promise<unknown>,
  member: { id: string },
  nativeId: string,
  attempts = 3,
): Promise<LinkResult> {
  for (let i = 0; i < attempts; i++) {
    try {
      await updateMember(member.id, { base44_user_id: nativeId });
      return res('IDENTITY_LINKED');
    } catch { /* reintento */ }
  }
  return res('LINK_COMPLETION_PENDING', 503);
}

export const IDENTITY_KEY = (sub: string) => `trucky:billing:identity:v1:${sub}`;
export const NATIVE_KEY = (nativeId: string) => `trucky:billing:native:v1:${nativeId}`;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface ResumeDeps extends PilotConfig {
  redis: RedisCommand;
  findMembers: (q: Record<string, unknown>) => Promise<any[]>;
  updateMember: (id: string, data: { base44_user_id: string }) => Promise<unknown>;
  assertProvenance: (redis: RedisCommand, member: any) => Promise<void>;
}

/**
 * Completa una vinculación que quedó a medias. La prueba es el registro
 * atómico bidireccional de Redis: native→sub y sub→native deben coincidir
 * con el usuario de la sesión. No necesita el código ni el token.
 */
export async function resumePendingBinding(nativeId: string, deps: ResumeDeps): Promise<LinkResult> {
  if (!SAFE_ID.test(nativeId)) return res('INVALID_REQUEST', 400);
  const sub = await deps.redis(['GET', NATIVE_KEY(nativeId)]);
  if (typeof sub !== 'string' || !SAFE_ID.test(sub)) return res('NO_PENDING_LINK', 409);
  if ((await deps.redis(['GET', IDENTITY_KEY(sub)])) !== nativeId) return res('LINK_REQUIRES_REVIEW', 409);
  const members = (await deps.findMembers({ google_sub: sub, active: true })).filter((m) => pilotAllowsMember(deps, m));
  if (members.length !== 1) return res('VERIFIED_MEMBERSHIP_REQUIRED', 403);
  const member = members[0];
  await deps.assertProvenance(deps.redis, member);
  if (member.base44_user_id === nativeId) return res('IDENTITY_LINKED');
  if (member.base44_user_id) return res('IDENTITY_ALREADY_BOUND', 409);
  return completeMemberBinding(deps.updateMember, member, nativeId);
}
