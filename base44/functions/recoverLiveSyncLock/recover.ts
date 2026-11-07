/**
 * Recuperación administrativa del bloqueo de la sincronización live.
 * Nunca borra a ciegas:
 *  1. Solo un administrador autenticado y en la lista del servidor.
 *  2. `preview` (sin escrituras) informa: dueño del bloqueo, antigüedad y si la
 *     escritura pendiente se APLICÓ, NO se aplicó o quedó PARCIAL (comparando
 *     los 5 campos live actuales con `fields` y `before` del registro pendiente).
 *  3. `release` exige: confirmación exacta, el mismo `owner` revisado en el
 *     preview, antigüedad mínima (sin escritura en curso) y un resultado
 *     determinado (aplicada / no aplicada / sin escritura). Libera lock y
 *     pending de forma atómica SOLO si el lock sigue siendo de ese dueño.
 *  4. Cada liberación queda auditada (sin tokens ni datos personales).
 * Nunca modifica la Organization ni reintenta la escritura.
 */
import {
  type Command, lockKey, pendingKey, ownerTakenAt, sameLiveFields, pickLiveFields,
  RELEASE_LOCK_AND_PENDING_SCRIPT, RECOVERY_AUDIT_KEY,
} from './lock.ts';

/** Una escritura en curso termina mucho antes; antes de esto no se libera. */
export const MIN_LOCK_AGE_MS = 5 * 60 * 1000;

export interface RecoverDeps {
  enabled: boolean;
  adminIds: Set<string>;
  getCaller: () => Promise<{ id?: string; role?: string } | null>;
  redis: Command;
  organizations: (id: string) => Promise<any[]>;
  now: () => number;
}
export interface RecoverResult { status: number; body: Record<string, unknown> }
const out = (code: string, status = 200, extra: Record<string, unknown> = {}): RecoverResult =>
  ({ status, body: { code, ...extra } });
const safe = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(s);

export type Outcome = 'NO_WRITE_STARTED' | 'WRITE_APPLIED' | 'WRITE_NOT_APPLIED' | 'WRITE_PARTIAL' | 'INCONSISTENT';
const RELEASABLE: Outcome[] = ['NO_WRITE_STARTED', 'WRITE_APPLIED', 'WRITE_NOT_APPLIED'];

async function inspect(orgId: string, deps: RecoverDeps) {
  const owner = await deps.redis(['GET', lockKey(orgId)]);
  const rawPending = await deps.redis(['GET', pendingKey(orgId)]);
  if (owner == null && rawPending == null) return { state: 'NO_LOCK' as const };
  let pending: any = null;
  if (rawPending != null) {
    try { pending = JSON.parse(String(rawPending)); } catch { pending = { invalid: true }; }
  }
  const takenAt = ownerTakenAt(owner);
  const ageMs = takenAt == null ? null : deps.now() - takenAt;
  let outcome: Outcome;
  if (owner == null || takenAt == null || (pending && (pending.invalid || pending.owner !== owner || pending.orgId !== orgId))) {
    outcome = 'INCONSISTENT';
  } else if (!pending) {
    outcome = 'NO_WRITE_STARTED';
  } else {
    const orgs = await deps.organizations(orgId);
    if (orgs.length !== 1 || orgs[0].id !== orgId) outcome = 'INCONSISTENT';
    else {
      const current = pickLiveFields(orgs[0]);
      outcome = sameLiveFields(current, pending.fields) ? 'WRITE_APPLIED'
        : sameLiveFields(current, pending.before) ? 'WRITE_NOT_APPLIED'
        : 'WRITE_PARTIAL';
    }
  }
  return { state: 'LOCKED' as const, owner: owner as string | null, ageMs, outcome, subscriptionId: pending?.subscriptionId ?? null };
}

export async function recoverLiveSyncLock(body: any, deps: RecoverDeps): Promise<RecoverResult> {
  if (!deps.enabled) return out('RECOVERY_NOT_ENABLED', 503);
  const caller = await deps.getCaller().catch(() => null);
  if (!caller?.id) return out('ADMIN_SESSION_REQUIRED', 401);
  if (caller.role !== 'admin' || !deps.adminIds.has(caller.id)) return out('ADMIN_NOT_AUTHORIZED', 403);
  if (!body || typeof body !== 'object' || (body.mode !== 'preview' && body.mode !== 'release') || !safe(body.organization_id)) {
    return out('INVALID_REQUEST', 400);
  }
  const orgId: string = body.organization_id;
  try {
    const info = await inspect(orgId, deps);
    if (info.state === 'NO_LOCK') return out('NO_LOCK', 200, { mode: body.mode });
    const minAgeOk = info.ageMs != null && info.ageMs >= MIN_LOCK_AGE_MS;
    const canRelease = RELEASABLE.includes(info.outcome) && minAgeOk;
    const report = {
      owner: info.owner, ageSeconds: info.ageMs == null ? null : Math.floor(info.ageMs / 1000),
      outcome: info.outcome, subscriptionId: info.subscriptionId, canRelease,
    };
    if (body.mode === 'preview') return out('RECOVERY_PREVIEW', 200, { mode: 'preview', ...report });

    // release
    if (body.confirm !== `RELEASE ${orgId}`) return out('CONFIRMATION_REQUIRED', 400, report);
    if (typeof body.owner !== 'string' || body.owner !== info.owner) return out('OWNER_MISMATCH', 409, report);
    if (!RELEASABLE.includes(info.outcome)) return out('REVIEW_REQUIRED', 409, report);
    if (!minAgeOk) return out('LOCK_TOO_RECENT', 409, report);

    const released = await deps.redis(['EVAL', RELEASE_LOCK_AND_PENDING_SCRIPT, '2', lockKey(orgId), pendingKey(orgId), info.owner]);
    if (released !== 1) return out('LOCK_CHANGED', 409, report);
    await deps.redis(['RPUSH', RECOVERY_AUDIT_KEY, JSON.stringify({
      at: new Date(deps.now()).toISOString(), adminId: caller.id, orgId, owner: info.owner,
      outcome: info.outcome, subscriptionId: info.subscriptionId,
    })]);
    return out('LOCK_RELEASED', 200, { mode: 'release', ...report, canRelease: false });
  } catch {
    return out('RECOVERY_REQUIRES_REVIEW', 503);
  }
}
