// Pago en curso: cuando Vercel confirma que una empresa puede pagar
// (checkLiveCheckoutEligibility = LIVE_CHECKOUT_ELIGIBLE), se marca por 2 horas.
// Mientras tanto la app muestra "Estamos activando tu cuenta…" en vez de
// "no tienes Demo activa". Es solo un aviso: NO da acceso ni plan; el acceso
// lo da únicamente la suscripción verificada en Stripe (stripe_live_*).
export type RedisCommand = (command: unknown[]) => Promise<unknown>;
export const CHECKOUT_PENDING_TTL_SECONDS = 2 * 60 * 60;
const safe = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(s);
export const checkoutPendingKey = (orgId: string) => `trucky:billing:checkout:v1:pending:${orgId}`;

export async function markCheckoutPending(redis: RedisCommand, orgId: unknown) {
  if (!safe(orgId)) return false;
  await redis(['SET', checkoutPendingKey(orgId), '1', 'EX', String(CHECKOUT_PENDING_TTL_SECONDS)]);
  return true;
}

export async function isCheckoutPending(redis: RedisCommand, orgIds: unknown[]) {
  for (const id of orgIds) {
    if (safe(id) && await redis(['GET', checkoutPendingKey(id)]) === '1') return true;
  }
  return false;
}

export async function clearCheckoutPending(redis: RedisCommand, orgId: unknown) {
  if (!safe(orgId)) return;
  await redis(['DEL', checkoutPendingKey(orgId)]);
}
