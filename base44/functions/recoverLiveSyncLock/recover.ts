/**
 * Recuperación administrativa del bloqueo de la sincronización live.
 * Nunca borra a ciegas y nunca libera sin evidencia de que no queda una
 * escritura que pueda aplicarse tarde:
 *
 *  - NO_WRITE_STARTED: hay lock pero no registro pendiente. Es seguro porque
 *    el proceso solo puede registrar el pendiente (y luego escribir) si
 *    todavía es dueño del lock (SET_PENDING_IF_OWNER_SCRIPT). Al liberarlo,
 *    ese proceso ya no puede escribir. La liberación verifica atómicamente
 *    que el pendiente siga sin existir.
 *  - WRITE_APPLIED: los 5 campos live actuales son exactamente los del
 *    pendiente → la escritura terminó. Liberable.
 *  - WRITE_NOT_APPLIED_YET: los campos siguen como antes. NO prueba que la
 *    escritura no vaya a aplicarse más tarde (podría sobrescribir una
 *    cancelación con `active`). Se conserva el bloqueo.
 *  - WRITE_PARTIAL / INCONSISTENT: revisión manual. Se conserva el bloqueo.
 *
 * La auditoría y la liberación ocurren en UNA operación atómica de Redis
 * (RECOVERY_RELEASE_SCRIPT): si el registro de auditoría falla, no se libera.
 * Nunca modifica la Organization ni reintenta la escritura.
 */
import {
  type Command, lockKey, pendingKey, ownerTakenAt, sameLiveFields, pickLiveFields,
  RECOVERY_RELEASE_SCRIPT, RECOVERY_AUDIT_KEY,
} from './lock.ts';

/**
 * Cortesía operativa para no interrumpir un proceso vivo antes de que
 * registre su pendiente. NO es una garantía de seguridad: la garantía la dan
 * el fencing del pendiente y la verificación de la escritura aplicada.
 */
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

export type Outcome = 'NO_WRITE_STARTED' | 'WRITE_APPLIED' | 'WRITE_NOT_APPLIED_YET' | 'WRITE_PARTIAL' | 'INCONSISTENT';
/** Solo hay evidencia de que no queda escritura pendiente en estos dos casos. */
const RELEASABLE: Outcome[] = ['NO_WRITE_STARTED', 'WRITE_APPLIED'];

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
        : sameLiveFields(current, pending.before) ? 'WRITE_NOT_APPLIED_YET'
        : 'WRITE_PARTIAL';
    }
  }
  return {
    state: 'LOCKED' as const, owner: owner as string | null, ageMs, outcome,
    hasPending: rawPending != null, subscriptionId: pending?.subscriptionId ?? null,
  };
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
    if (info.outcome === 'WRITE_NOT_APPLIED_YET') return out('WRITE_NOT_APPLIED_YET', 409, report);
    if (!RELEASABLE.includes(info.outcome)) return out('REVIEW_REQUIRED', 409, report);
    if (!minAgeOk) return out('LOCK_TOO_RECENT', 409, report);

    // Auditoría + liberación atómicas: el RPUSH va antes que los DEL en el mismo script.
    const auditEntry = JSON.stringify({
      at: new Date(deps.now()).toISOString(), event: 'live_sync_lock_released', adminId: caller.id, orgId,
      owner: info.owner, outcome: info.outcome, subscriptionId: info.subscriptionId,
    });
    const released = await deps.redis([
      'EVAL', RECOVERY_RELEASE_SCRIPT, '3', lockKey(orgId), pendingKey(orgId), RECOVERY_AUDIT_KEY,
      info.owner, info.hasPending ? '1' : '0', auditEntry,
    ]);
    if (released === 0) return out('LOCK_CHANGED', 409, report);
    if (released !== 1) return out('REVIEW_REQUIRED', 409, report);
    return out('LOCK_RELEASED', 200, { mode: 'release', ...report, canRelease: false });
  } catch {
    // Incluye un fallo del script (p. ej. no se pudo escribir la auditoría): el lock se conserva.
    return out('RECOVERY_REQUIRES_REVIEW', 503);
  }
}
