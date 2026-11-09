/**
 * TEMPORARY server probe (service role) of Base44 updateMany semantics on ONE
 * configured TEST membership. Answers, with evidence from Base44 itself:
 *  - absent field matches {$exists:false};  - explicit null matches null;
 *  - a value requires that exact value;      - other identity / concurrent change is rejected without overwrite;
 *  - an identical repeat returns updated:0 and is recognized as idempotent only by a verified read.
 * Only base44_user_id is written (probe values), google_sub is only used as a
 * condition and never written. The original state (base44_user_id absent) is restored.
 * Report contains codes, counts and labels — never identity values.
 */
import { fieldCondition, type Rec } from './memberWrite.ts';

export interface ProbeDeps {
  enabled: boolean; adminIds: Set<string>; memberId?: string; orgId?: string;
  pilotOrgIds: Set<string>; pilotMemberIds: Set<string>;
  user: () => Promise<any>;
  read: (id: string) => Promise<Rec | null>;
  updateMany: (query: Rec, data: Rec) => Promise<any>;
  redis: (c: unknown[]) => Promise<unknown>;
  runId: () => string;
}
const safe = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const out = (code: string, status = 200, extra: Rec = {}) => ({ status, body: { code, ...extra } });

export async function probeUpdateMany(body: any, d: ProbeDeps) {
  if (!d.enabled) return out('PROBE_DISABLED', 503);
  const user = await d.user().catch(() => null);
  if (!safe(user?.id)) return out('ADMIN_SESSION_REQUIRED', 401);
  if (user.role !== 'admin' || !d.adminIds.has(user.id)) return out('ADMIN_NOT_AUTHORIZED', 403);
  if (!safe(d.memberId) || !safe(d.orgId)) return out('PROBE_TARGET_NOT_CONFIGURED', 503);
  if (body?.confirm !== `PROBE ${d.memberId}`) return out('CONFIRMATION_REQUIRED', 400);
  const memberId = d.memberId, orgId = d.orgId;
  // Never a pilot/customer/enrolled membership.
  if (d.pilotMemberIds.has(memberId) || d.pilotOrgIds.has(orgId)) return out('PILOT_TARGET_REFUSED', 403);
  if (await d.redis(['GET', `trucky:billing:enrollment:v1:org:${orgId}`]) != null) return out('ENROLLED_TARGET_REFUSED', 403);

  const start = await d.read(memberId);
  if (!start || start.id !== memberId || start.organization_id !== orgId || start.role !== 'owner' || start.active !== true) {
    return out('PROBE_TARGET_INVALID', 409);
  }
  // Precondition so the original state can be restored exactly.
  if (Object.hasOwn(start, 'base44_user_id') && start.base44_user_id !== undefined) return out('PROBE_PRECONDITION_BASE44_USER_ID_NOT_ABSENT', 409);
  const gsCond = fieldCondition(start, 'google_sub');
  const gsBefore = JSON.stringify(start.google_sub ?? null);
  const run = d.runId().replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'run';
  const P = (n: number) => `probe-${run}-${n}`;
  const label = (r: Rec | null) => {
    if (!r) return 'record-missing';
    if (!Object.hasOwn(r, 'base44_user_id') || r.base44_user_id === undefined) return 'absent';
    if (r.base44_user_id === null) return 'null';
    const v = String(r.base44_user_id);
    return v.startsWith(`probe-${run}-`) ? `P${v.slice(-1)}` : 'other-value';
  };
  const pin = { id: memberId, organization_id: orgId, role: 'owner', active: true, google_sub: gsCond };
  const steps: Rec[] = [];
  const step = async (name: string, query: Rec, data: Rec, expectUpdated: number, expectState: string) => {
    const r = await d.updateMany(query, data);
    const state = label(await d.read(memberId));
    const ok = r?.updated === expectUpdated && state === expectState;
    steps.push({ name, updated: r?.updated ?? null, expectUpdated, state, expectState, ok });
    return { ok, state };
  };
  let nullStoredAs: string | null = null, existsFalseMatchesNull: boolean | null = null, idempotent: boolean | null = null;
  try {
    // 1) Absent field → {$exists:false}.
    await step('absent_matches_exists_false', { ...pin, base44_user_id: { $exists: false } }, { $set: { base44_user_id: P(1) } }, 1, 'P1');
    // 2) Identical repeat → updated 0 (counts modifications); idempotency is recognized
    //    ONLY by a verified read showing the exact target (google_sub is never written).
    const rep = await d.updateMany({ ...pin, base44_user_id: P(1) }, { $set: { base44_user_id: P(1) } });
    const repState = label(await d.read(memberId));
    idempotent = rep?.updated === 0 && repState === 'P1';
    steps.push({ name: 'identical_repeat_idempotent_by_verified_read', updated: rep?.updated ?? null, expectUpdated: 0, state: repState, expectState: 'P1', ok: idempotent });
    // 3) Value present → requires that exact value.
    await step('wrong_value_rejected', { ...pin, base44_user_id: 'probe-wrong' }, { $set: { base44_user_id: P(2) } }, 0, 'P1');
    // 4) Different identity (google_sub) → rejected, no overwrite.
    await step('other_identity_rejected', { ...pin, google_sub: 'probe-other-sub', base44_user_id: P(1) }, { $set: { base44_user_id: P(2) } }, 0, 'P1');
    // 5) Set explicit null, observe how Base44 stores it.
    const n = await step('set_explicit_null', { ...pin, base44_user_id: P(1) }, { $set: { base44_user_id: null } }, 1, 'null');
    nullStoredAs = n.state;
    // 6) {$exists:false} on explicit null (informational: Mongo semantics → no match).
    const ef = await d.updateMany({ ...pin, base44_user_id: { $exists: false } }, { $set: { base44_user_id: P(3) } });
    const efState = label(await d.read(memberId));
    existsFalseMatchesNull = ef?.updated === 1;
    steps.push({ name: 'exists_false_on_null_informational', updated: ef?.updated ?? null, state: efState, ok: true });
    if (efState === 'P3') await d.updateMany({ ...pin, base44_user_id: P(3) }, { $set: { base44_user_id: null } });
    // 7) Explicit null → condition null.
    await step('null_matches_null', { ...pin, base44_user_id: null }, { $set: { base44_user_id: P(4) } }, 1, 'P4');
    // 8) Concurrent change: another writer moves P4→P5; stale condition P4 must not overwrite.
    await step('concurrent_writer', { ...pin, base44_user_id: P(4) }, { $set: { base44_user_id: P(5) } }, 1, 'P5');
    await step('stale_condition_rejected', { ...pin, base44_user_id: P(4) }, { $set: { base44_user_id: P(6) } }, 0, 'P5');
  } catch {
    steps.push({ name: 'error', ok: false });
  }
  // Restore: remove base44_user_id only if it currently holds a probe value or null.
  let restored = false;
  try {
    const cur = await d.read(memberId);
    const st = label(cur);
    if (st === 'absent') restored = true;
    else if (/^P\d$/.test(st)) {
      await d.updateMany({ id: memberId, organization_id: orgId, base44_user_id: cur!.base44_user_id as unknown }, { $unset: { base44_user_id: '' } });
      restored = label(await d.read(memberId)) === 'absent';
    } else if (st === 'null') {
      // Do not depend on the semantics under test: try null, then "present" ($exists:true).
      await d.updateMany({ id: memberId, organization_id: orgId, base44_user_id: null }, { $unset: { base44_user_id: '' } });
      if (label(await d.read(memberId)) === 'null') {
        await d.updateMany({ id: memberId, organization_id: orgId, base44_user_id: { $exists: true } }, { $unset: { base44_user_id: '' } });
      }
      restored = label(await d.read(memberId)) === 'absent';
    }
  } catch { restored = false; }
  const end = await d.read(memberId).catch(() => null);
  const googleSubUnchanged = !!end && JSON.stringify(end.google_sub ?? null) === gsBefore;
  const passed = steps.every((s) => s.ok === true) && restored && googleSubUnchanged;
  return out(passed ? 'PROBE_PASSED' : 'PROBE_FAILED', 200, {
    steps, nullStoredAs, existsFalseMatchesNull, idempotentByVerifiedRead: idempotent, restored, googleSubUnchanged,
    googleSubState: typeof start.google_sub === 'string' ? 'value' : label({ base44_user_id: start.google_sub } as Rec),
  });
}
