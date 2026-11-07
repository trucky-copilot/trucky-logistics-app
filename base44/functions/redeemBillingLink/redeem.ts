/**
 * Lógica de redeemBillingLink sin E/S directa (dependencias inyectadas) para
 * poder probarla: identidad incorrecta, expiración, reutilización y
 * vinculación idempotente. Mismo comportamiento que la versión de la rama
 * vercel-agent/live-stripe-mode.
 *
 * El código del enlace nunca se guarda ni se registra: solo se usa su SHA-256
 * como clave del ticket en Redis, que se consume con GETDEL (un solo uso).
 */
export type RedisCommand = (command: unknown[]) => Promise<unknown>;

export interface RedeemDeps {
  enabled: boolean;
  getUser: () => Promise<{ id?: string; email?: string } | null>;
  redis: RedisCommand;
  findMembers: (q: { organization_id: string; google_sub: string; active: true }) => Promise<any[]>;
  updateMember: (id: string, data: { base44_user_id: string }) => Promise<unknown>;
  assertProvenance: (redis: RedisCommand, member: any) => Promise<void>;
  reserveBinding: (redis: RedisCommand, googleSub: string, nativeId: string) => Promise<void>;
  sha256Hex: (text: string) => Promise<string>;
}

export interface RedeemResult { status: number; code: string }
const r = (code: string, status = 200): RedeemResult => ({ code, status });

export const HANDOFF_PREFIX = 'trucky:billing:handoff:v1:';

export async function redeemBillingLinkCore(body: any, deps: RedeemDeps): Promise<RedeemResult> {
  if (!deps.enabled) return r('LINK_NOT_ENABLED', 503);
  try {
    const user = await deps.getUser();
    if (!user?.id || !user?.email) return r('NATIVE_SESSION_REQUIRED', 401);
    if (body?.confirm !== true || typeof body?.code !== 'string' || !/^[a-f0-9]{64}$/.test(body.code)) return r('INVALID_REQUEST', 400);

    const key = HANDOFF_PREFIX + await deps.sha256Hex(body.code);
    // Se verifica la cuenta ANTES de consumir el ticket; luego GETDEL evita la reutilización.
    const raw = await deps.redis(['GET', key]);
    if (!raw) return r('LINK_EXPIRED', 409);
    const identity = JSON.parse(String(raw));
    if (identity.email !== user.email.toLowerCase()) return r('IDENTITY_MISMATCH', 403);
    const consumed = await deps.redis(['GETDEL', key]);
    if (consumed !== raw) return r('LINK_ALREADY_USED', 409);

    const members = await deps.findMembers({ organization_id: identity.orgId, google_sub: identity.sub, active: true });
    if (members.length !== 1) return r('VERIFIED_MEMBERSHIP_REQUIRED', 403);
    const member = members[0];
    await deps.assertProvenance(deps.redis, member);
    if (member.base44_user_id && member.base44_user_id !== user.id) return r('IDENTITY_ALREADY_BOUND', 409);
    await deps.reserveBinding(deps.redis, identity.sub, user.id);
    if (!member.base44_user_id) await deps.updateMember(member.id, { base44_user_id: user.id });
    return r('IDENTITY_LINKED');
  } catch {
    return r('LINK_REQUIRES_REVIEW', 503);
  }
}
