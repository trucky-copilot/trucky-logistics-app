/**
 * Bloqueo de la sincronización live por organización y registro de escritura
 * pendiente. Archivo idéntico en syncBillingSubscription/ y recoverLiveSyncLock/.
 *
 * - lock:    `<NS>:org:<org>` = token del propietario "<ms>:<uuid>" (sin TTL).
 * - pending: `<NS>:pending:org:<org>` = JSON { owner, orgId, subscriptionId,
 *            fields, before, startedAt }, escrito justo ANTES de actualizar
 *            Base44 y borrado junto con el lock SOLO cuando la escritura terminó.
 * Si la escritura queda en duda, ambos se conservan para revisión administrativa.
 */
export type Command = (command: unknown[]) => Promise<unknown>;

export const LIVE_FIELDS = [
  'stripe_live_subscription_id',
  'stripe_live_customer_id',
  'stripe_live_price_id',
  'stripe_live_plan_type',
  'stripe_live_subscription_status',
] as const;

export const lockKey = (orgId: string) => `trucky:billing:sync:live:org:${orgId}`;
export const pendingKey = (orgId: string) => `trucky:billing:sync:live:pending:org:${orgId}`;
export const RECOVERY_AUDIT_KEY = 'trucky:billing:sync:live:recovery:audit';

/** Token del propietario con la hora de toma del bloqueo, para medir su antigüedad. */
export const makeOwner = (nowMs: number, id: string) => `${nowMs}:${id}`;
export function ownerTakenAt(owner: unknown): number | null {
  if (typeof owner !== 'string') return null;
  const m = owner.match(/^(\d{10,16}):[A-Za-z0-9-]{1,64}$/);
  return m ? Number(m[1]) : null;
}

/** Libera SOLO el lock, y solo si sigue siendo de `owner`. No toca `pending`. */
export const RELEASE_LOCK_SCRIPT =
  "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";

/**
 * Libera lock y pending de forma atómica, solo si el lock sigue siendo de
 * `owner` y el pending (si existe) pertenece al mismo propietario.
 */
export const RELEASE_LOCK_AND_PENDING_SCRIPT = [
  "if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end",
  "local p = redis.call('GET',KEYS[2])",
  "if p and not string.find(p, '\"owner\":\"' .. ARGV[1] .. '\"', 1, true) then return -1 end",
  "redis.call('DEL',KEYS[2])",
  "redis.call('DEL',KEYS[1])",
  "return 1",
].join('\n');

export function pickLiveFields(org: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of LIVE_FIELDS) out[k] = org?.[k] ?? null;
  return out;
}

export function sameLiveFields(a: Record<string, unknown>, b: Record<string, unknown>) {
  return LIVE_FIELDS.every((k) => (a?.[k] ?? null) === (b?.[k] ?? null));
}
