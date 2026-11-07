// Recuperación administrativa del bloqueo de la sincronización live.
// Usa la lógica real de syncBillingSubscription (live.ts) para provocar una
// escritura incierta y luego revisarla/liberarla con recoverLiveSyncLock.
import { assertEquals } from 'jsr:@std/assert@1';
import { reconcileLiveSubscription } from '../../base44/functions/syncBillingSubscription/live.ts';
import { recoverLiveSyncLock, MIN_LOCK_AGE_MS, type RecoverDeps } from '../../base44/functions/recoverLiveSyncLock/recover.ts';
import { lockKey, pendingKey, RECOVERY_AUDIT_KEY } from '../../base44/functions/recoverLiveSyncLock/lock.ts';
import { assertMembershipProvenance } from '../../base44/functions/syncBillingSubscription/provenance.ts';

const ORG = 'org';
const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const LOCK = lockKey(ORG), PENDING = pendingKey(ORG);
const member = { id: 'member', organization_id: ORG, google_sub: 'google', base44_user_id: 'native', active: true, role: 'owner' };
const price = { id: 'price_owner', livemode: true, currency: 'usd', unit_amount: 2900, type: 'recurring', recurring: { interval: 'month', interval_count: 1 }, billing_scheme: 'per_unit' };
const subscription = { id: 'sub_live', customer: 'cus_live', metadata: { org_id: ORG }, livemode: true, status: 'active', trial_start: null, trial_end: null, items: { has_more: false, data: [{ quantity: 1, price }] } };
const body = { mode: 'live', organization_id: ORG, subscription_id: 'sub_live' };

function world() {
  const store = new Map<string, any>([
    ['trucky:billing:identity:v1:google', 'native'], ['trucky:billing:native:v1:native', 'google'],
    ['trucky:billing:member:v1:org:google', JSON.stringify({ orgId: ORG, googleSub: 'google', memberId: 'member', role: 'owner' })],
  ]);
  const writes: unknown[][] = [];
  const redis = async (c: unknown[]) => {
    const [op, key, value] = c as string[];
    if (op === 'GET') return store.get(key) ?? null;
    writes.push(c);
    if (op === 'SET') { if (c.includes('NX') && store.has(key)) return null; store.set(key, value); return 'OK'; }
    if (op === 'RPUSH') { const l = store.get(key) ?? []; l.push(value); store.set(key, l); return l.length; }
    if (op === 'EVAL') {
      if (c[2] === '1') { if (store.get(c[3] as string) === c[4]) { store.delete(c[3] as string); return 1; } return 0; }
      const [lock, pend, owner] = [c[3], c[4], c[5]] as string[];
      if (store.get(lock) !== owner) return 0;
      const p = store.get(pend); if (p && JSON.parse(p).owner !== owner) return -1;
      store.delete(pend); store.delete(lock); return 1;
    }
    throw new Error('unexpected ' + op);
  };
  const org: any = { id: ORG, active: true, stripe_subscription_id: 'sub_test', plan_type: 'plan_29' };
  let now = T0;
  return {
    store, writes, org, redis,
    clock: { get: () => now, advance: (ms: number) => { now += ms; } },
    syncDeps: (update: (id: string, f: any) => Promise<unknown>) => ({
      enabled: true, orgIds: new Set([ORG]), memberIds: new Set(['member']), prices: { owner_op: 'price_owner', fleet: 'price_fleet' },
      redis, assertProvenance: assertMembershipProvenance, owner: () => 'uuid-1', now: () => now,
      organizations: async () => [org], members: async () => [{ ...member }],
      retrieve: async () => structuredClone(subscription), update,
    }),
    recDeps: (over: Partial<RecoverDeps> = {}): RecoverDeps => ({
      enabled: true, adminIds: new Set(['admin-1']), getCaller: async () => ({ id: 'admin-1', role: 'admin' }),
      redis, organizations: async () => [org], now: () => now, ...over,
    }),
  };
}

/** Deja una escritura incierta: el lock y el pending quedan retenidos. */
async function uncertainWrite(w: ReturnType<typeof world>, applied: boolean) {
  const r = await reconcileLiveSubscription(body, w.syncDeps(async (_id, f) => { if (applied) Object.assign(w.org, f); throw new Error('timeout'); }));
  assertEquals(r.body.code, 'LIVE_WRITE_REQUIRES_REVIEW');
  assertEquals(w.store.has(LOCK) && w.store.has(PENDING), true);
}
const preview = { mode: 'preview', organization_id: ORG };

Deno.test('recuperación: apagada, sin sesión, no admin o fuera de la lista → rechazado sin leer', async () => {
  const w = world();
  let reads = 0;
  const spy = async () => { reads++; return null; };
  assertEquals((await recoverLiveSyncLock(preview, w.recDeps({ enabled: false, redis: spy }))).body.code, 'RECOVERY_NOT_ENABLED');
  assertEquals((await recoverLiveSyncLock(preview, w.recDeps({ getCaller: async () => null, redis: spy }))).body.code, 'ADMIN_SESSION_REQUIRED');
  assertEquals((await recoverLiveSyncLock(preview, w.recDeps({ getCaller: async () => ({ id: 'u', role: 'user' }), redis: spy }))).body.code, 'ADMIN_NOT_AUTHORIZED');
  assertEquals((await recoverLiveSyncLock(preview, w.recDeps({ getCaller: async () => ({ id: 'admin-2', role: 'admin' }), redis: spy }))).body.code, 'ADMIN_NOT_AUTHORIZED');
  assertEquals(reads, 0);
});

Deno.test('preview: informa escritura NO aplicada y no escribe nada', async () => {
  const w = world();
  await uncertainWrite(w, false);
  const before = w.writes.length;
  w.clock.advance(MIN_LOCK_AGE_MS + 1000);
  const r = await recoverLiveSyncLock(preview, w.recDeps());
  assertEquals(r.body.code, 'RECOVERY_PREVIEW');
  assertEquals(r.body.outcome, 'WRITE_NOT_APPLIED');
  assertEquals(r.body.owner, w.store.get(LOCK));
  assertEquals(r.body.canRelease, true);
  assertEquals(w.writes.length, before);
});

Deno.test('liberación: exige confirmación exacta y el mismo dueño revisado', async () => {
  const w = world();
  await uncertainWrite(w, false);
  w.clock.advance(MIN_LOCK_AGE_MS + 1000);
  const owner = w.store.get(LOCK);
  assertEquals((await recoverLiveSyncLock({ mode: 'release', organization_id: ORG, owner }, w.recDeps())).body.code, 'CONFIRMATION_REQUIRED');
  assertEquals((await recoverLiveSyncLock({ mode: 'release', organization_id: ORG, owner: '1:otro', confirm: `RELEASE ${ORG}` }, w.recDeps())).body.code, 'OWNER_MISMATCH');
  assertEquals(w.store.has(LOCK) && w.store.has(PENDING), true);
});

Deno.test('liberación: bloqueo demasiado reciente (posible escritura en curso) → LOCK_TOO_RECENT', async () => {
  const w = world();
  await uncertainWrite(w, false);
  const owner = w.store.get(LOCK);
  const r = await recoverLiveSyncLock({ mode: 'release', organization_id: ORG, owner, confirm: `RELEASE ${ORG}` }, w.recDeps());
  assertEquals(r.body.code, 'LOCK_TOO_RECENT');
  assertEquals(w.store.has(LOCK), true);
});

Deno.test('liberación de escritura NO aplicada: atómica, auditada, sin tocar la organización; luego la sincronización vuelve a funcionar', async () => {
  const w = world();
  await uncertainWrite(w, false);
  w.clock.advance(MIN_LOCK_AGE_MS + 1000);
  const orgBefore = structuredClone(w.org);
  const owner = w.store.get(LOCK);
  const r = await recoverLiveSyncLock({ mode: 'release', organization_id: ORG, owner, confirm: `RELEASE ${ORG}` }, w.recDeps());
  assertEquals(r.body.code, 'LOCK_RELEASED');
  assertEquals(r.body.outcome, 'WRITE_NOT_APPLIED');
  assertEquals(w.store.has(LOCK) || w.store.has(PENDING), false);
  assertEquals(w.org, orgBefore);
  const audit = w.store.get(RECOVERY_AUDIT_KEY).map((x: string) => JSON.parse(x));
  assertEquals(audit.length, 1);
  assertEquals([audit[0].adminId, audit[0].orgId, audit[0].owner, audit[0].outcome], ['admin-1', ORG, owner, 'WRITE_NOT_APPLIED']);
  const again = await reconcileLiveSubscription(body, w.syncDeps(async (_id, f) => Object.assign(w.org, f)));
  assertEquals(again.body.code, 'SUBSCRIPTION_RECONCILED');
});

Deno.test('liberación de escritura que SÍ se aplicó (timeout después de escribir) → WRITE_APPLIED', async () => {
  const w = world();
  await uncertainWrite(w, true);
  w.clock.advance(MIN_LOCK_AGE_MS + 1000);
  const p = await recoverLiveSyncLock(preview, w.recDeps());
  assertEquals(p.body.outcome, 'WRITE_APPLIED');
  const r = await recoverLiveSyncLock({ mode: 'release', organization_id: ORG, owner: p.body.owner, confirm: `RELEASE ${ORG}` }, w.recDeps());
  assertEquals([r.body.code, r.body.outcome], ['LOCK_RELEASED', 'WRITE_APPLIED']);
  assertEquals(w.org.stripe_live_subscription_id, 'sub_live');
});

Deno.test('escritura PARCIAL o registro inconsistente → REVIEW_REQUIRED, nunca se libera', async () => {
  const w = world();
  await uncertainWrite(w, false);
  w.clock.advance(MIN_LOCK_AGE_MS + 1000);
  w.org.stripe_live_subscription_id = 'sub_live'; // solo un campo cambió
  const owner = w.store.get(LOCK);
  const r = await recoverLiveSyncLock({ mode: 'release', organization_id: ORG, owner, confirm: `RELEASE ${ORG}` }, w.recDeps());
  assertEquals([r.body.code, r.body.outcome], ['REVIEW_REQUIRED', 'WRITE_PARTIAL']);
  assertEquals(w.store.has(LOCK) && w.store.has(PENDING), true);

  const w2 = world();
  await uncertainWrite(w2, false);
  w2.clock.advance(MIN_LOCK_AGE_MS + 1000);
  w2.store.set(PENDING, JSON.stringify({ ...JSON.parse(w2.store.get(PENDING)), owner: '1:otro' }));
  const r2 = await recoverLiveSyncLock({ mode: 'release', organization_id: ORG, owner: w2.store.get(LOCK), confirm: `RELEASE ${ORG}` }, w2.recDeps());
  assertEquals([r2.body.code, r2.body.outcome], ['REVIEW_REQUIRED', 'INCONSISTENT']);
});

Deno.test('si el bloqueo cambia de dueño entre la revisión y la liberación → LOCK_CHANGED, sin borrar', async () => {
  const w = world();
  await uncertainWrite(w, false);
  w.clock.advance(MIN_LOCK_AGE_MS + 1000);
  const owner = w.store.get(LOCK);
  const racing = async (c: unknown[]) => (c[0] === 'EVAL' ? 0 : w.redis(c));
  const r = await recoverLiveSyncLock({ mode: 'release', organization_id: ORG, owner, confirm: `RELEASE ${ORG}` }, w.recDeps({ redis: racing }));
  assertEquals(r.body.code, 'LOCK_CHANGED');
  assertEquals(w.store.has(LOCK) && w.store.has(PENDING), true);
  assertEquals(w.store.has(RECOVERY_AUDIT_KEY), false);
});

Deno.test('sin bloqueo → NO_LOCK; bloqueo sin escritura iniciada (proceso caído) se libera tras la espera', async () => {
  const w = world();
  assertEquals((await recoverLiveSyncLock(preview, w.recDeps())).body.code, 'NO_LOCK');
  w.store.set(LOCK, `${T0}:uuid-caido`);
  w.clock.advance(MIN_LOCK_AGE_MS + 1000);
  const p = await recoverLiveSyncLock(preview, w.recDeps());
  assertEquals([p.body.outcome, p.body.canRelease], ['NO_WRITE_STARTED', true]);
  const r = await recoverLiveSyncLock({ mode: 'release', organization_id: ORG, owner: p.body.owner, confirm: `RELEASE ${ORG}` }, w.recDeps());
  assertEquals(r.body.code, 'LOCK_RELEASED');
  assertEquals(w.store.has(LOCK), false);
});

Deno.test('lock.ts es idéntico en syncBillingSubscription y recoverLiveSyncLock', async () => {
  const a = await Deno.readTextFile(new URL('../../base44/functions/syncBillingSubscription/lock.ts', import.meta.url));
  const b = await Deno.readTextFile(new URL('../../base44/functions/recoverLiveSyncLock/lock.ts', import.meta.url));
  assertEquals(a, b);
});
