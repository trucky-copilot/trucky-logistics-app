/**
 * Lógica de linkBillingIdentity sin E/S directa (dependencias inyectadas).
 * El ID token de Google se verifica criptográficamente (verifyGoogleIdToken,
 * inyectado): nunca viaja en una URL. Mismo piloto y misma finalización
 * idempotente que redeemBillingLink (ver pilot.ts).
 */
import {
  type RedisCommand, type LinkResult, type PilotConfig, res, pilotConfigured, pilotAllowsOrg,
  pilotAllowsMember, completeMemberBinding, resumePendingBinding,
} from './pilot.ts';

export interface VerifiedGoogleIdentity { sub: string; email: string; email_verified: boolean }

export interface LinkDeps extends PilotConfig {
  enabled: boolean;
  getUser: () => Promise<{ id?: string; email?: string } | null>;
  verifyGoogleIdToken: (token: string) => Promise<VerifiedGoogleIdentity | null>;
  redis: RedisCommand;
  findMembers: (q: Record<string, unknown>) => Promise<any[]>;
  updateMember: (id: string, data: { base44_user_id: string }) => Promise<unknown>;
  assertProvenance: (redis: RedisCommand, member: any) => Promise<void>;
  reserveBinding: (redis: RedisCommand, googleSub: string, nativeId: string) => Promise<void>;
}

export async function linkBillingIdentityCore(body: any, deps: LinkDeps): Promise<LinkResult> {
  if (!deps.enabled) return res('LINK_NOT_ENABLED', 503);
  if (!pilotConfigured(deps)) return res('PILOT_NOT_CONFIGURED', 503);
  try {
    const native = await deps.getUser();
    if (!native?.id || !native?.email) return res('NATIVE_SESSION_REQUIRED', 401);
    // Igual que redeemBillingLink: completar una vinculación pendiente exige confirmación explícita.
    if (body?.resume === true) {
      if (body?.confirm !== true) return res('INVALID_REQUEST', 400);
      return await resumePendingBinding(native.id, deps);
    }

    if (typeof body?.google_id_token !== 'string' || body.google_id_token.length > 4096 || typeof body?.organization_id !== 'string') {
      return res('INVALID_REQUEST', 400);
    }
    if (!pilotAllowsOrg(deps, body.organization_id)) return res('PILOT_NOT_ALLOWED', 403);

    const identity = await deps.verifyGoogleIdToken(body.google_id_token).catch(() => null);
    if (!identity?.sub || identity.email_verified !== true) return res('GOOGLE_AUTHORIZATION_REQUIRED', 401);
    // Sesión nativa autenticada Y propiedad de Google verificada; el correo es solo verificación cruzada.
    if (typeof identity.email !== 'string' || identity.email.toLowerCase() !== native.email.toLowerCase()) return res('IDENTITY_MISMATCH', 403);

    const members = await deps.findMembers({ organization_id: body.organization_id, google_sub: identity.sub, active: true });
    if (members.length !== 1) return res('VERIFIED_MEMBERSHIP_REQUIRED', 403);
    const member = members[0];
    if (!pilotAllowsMember(deps, member)) return res('PILOT_NOT_ALLOWED', 403);
    await deps.assertProvenance(deps.redis, member);
    if (member.base44_user_id && member.base44_user_id !== native.id) return res('IDENTITY_ALREADY_BOUND', 409);
    try {
      await deps.reserveBinding(deps.redis, identity.sub, native.id);
    } catch (e) {
      if ((e as Error)?.message === 'IDENTITY_ALREADY_BOUND') return res('IDENTITY_ALREADY_BOUND', 409);
      throw e;
    }
    if (member.base44_user_id === native.id) return res('IDENTITY_LINKED');
    return await completeMemberBinding(deps.updateMember, member, native.id);
  } catch {
    return res('LINK_REQUIRES_REVIEW', 503);
  }
}
