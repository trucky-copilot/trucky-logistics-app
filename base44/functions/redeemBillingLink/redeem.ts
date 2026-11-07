/**
 * Lógica de redeemBillingLink sin E/S directa (dependencias inyectadas) para
 * poder probarla. El código del enlace nunca se guarda ni se registra: solo
 * se usa su SHA-256 como clave del ticket en Redis, que se consume con GETDEL.
 *
 * Orden: sesión → ticket (GET) → misma cuenta → piloto (org) → membresía
 * única del piloto → consumir ticket (GETDEL) → procedencia → vínculo atómico
 * → escribir base44_user_id (con reintentos; si falla, LINK_COMPLETION_PENDING
 * y se completa con { resume: true }, sin borrar nada).
 */
import {
  type RedisCommand, type LinkResult, type PilotConfig, res, pilotConfigured, pilotAllowsOrg,
  pilotAllowsMember, completeMemberBinding, resumePendingBinding,
} from './pilot.ts';

export type { RedisCommand };

export interface RedeemDeps extends PilotConfig {
  enabled: boolean;
  getUser: () => Promise<{ id?: string; email?: string } | null>;
  redis: RedisCommand;
  findMembers: (q: Record<string, unknown>) => Promise<any[]>;
  updateMember: (id: string, data: { base44_user_id: string }) => Promise<unknown>;
  assertProvenance: (redis: RedisCommand, member: any) => Promise<void>;
  reserveBinding: (redis: RedisCommand, googleSub: string, nativeId: string) => Promise<void>;
  sha256Hex: (text: string) => Promise<string>;
}

export type RedeemResult = LinkResult;
export const HANDOFF_PREFIX = 'trucky:billing:handoff:v1:';

export async function redeemBillingLinkCore(body: any, deps: RedeemDeps): Promise<RedeemResult> {
  if (!deps.enabled) return res('LINK_NOT_ENABLED', 503);
  if (!pilotConfigured(deps)) return res('PILOT_NOT_CONFIGURED', 503);
  try {
    const user = await deps.getUser();
    if (!user?.id || !user?.email) return res('NATIVE_SESSION_REQUIRED', 401);
    if (body?.confirm !== true) return res('INVALID_REQUEST', 400);

    // Completar una vinculación que quedó a medias (sin código).
    if (body.resume === true) return await resumePendingBinding(user.id, deps);

    if (typeof body.code !== 'string' || !/^[a-f0-9]{64}$/.test(body.code)) return res('INVALID_REQUEST', 400);
    const key = HANDOFF_PREFIX + await deps.sha256Hex(body.code);
    const raw = await deps.redis(['GET', key]);
    if (!raw) return res('LINK_EXPIRED', 409);
    const identity = JSON.parse(String(raw));
    if (identity.email !== user.email.toLowerCase()) return res('IDENTITY_MISMATCH', 403);
    if (!pilotAllowsOrg(deps, identity.orgId)) return res('PILOT_NOT_ALLOWED', 403);

    const members = await deps.findMembers({ organization_id: identity.orgId, google_sub: identity.sub, active: true });
    if (members.length !== 1) return res('VERIFIED_MEMBERSHIP_REQUIRED', 403);
    const member = members[0];
    if (!pilotAllowsMember(deps, member)) return res('PILOT_NOT_ALLOWED', 403);

    // Todo lo verificable sin escribir ya pasó: ahora sí se consume el ticket.
    const consumed = await deps.redis(['GETDEL', key]);
    if (consumed !== raw) return res('LINK_ALREADY_USED', 409);

    await deps.assertProvenance(deps.redis, member);
    if (member.base44_user_id && member.base44_user_id !== user.id) return res('IDENTITY_ALREADY_BOUND', 409);
    try {
      await deps.reserveBinding(deps.redis, identity.sub, user.id);
    } catch (e) {
      if ((e as Error)?.message === 'IDENTITY_ALREADY_BOUND') return res('IDENTITY_ALREADY_BOUND', 409);
      throw e;
    }
    if (member.base44_user_id === user.id) return res('IDENTITY_LINKED');
    return await completeMemberBinding(deps.updateMember, member, user.id);
  } catch {
    return res('LINK_REQUIRES_REVIEW', 503);
  }
}
