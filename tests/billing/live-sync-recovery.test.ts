// Recuperación administrativa del bloqueo de la sincronización live.
// Usa la lógica real de syncBillingSubscription (live.ts) para provocar
// escrituras inciertas y luego revisarlas/liberarlas con recoverLiveSyncLock.
import { assertEquals } from 'jsr:@std/assert@1';
import { reconcileLiveSubscription } from '../../base44/functions/syncBillingSubscription/live.ts';
import { recoverLiveSyncLock, MIN_LOCK_AGE_MS, type RecoverDeps } from '../../base44/functions/recoverLiveSyncLock/recover.ts';
import { lockKey, pendingKey, RECOVERY_AUDIT_KEY, OP_FIELD, LIVE_FIELDS, pickLiveFields, sameLiveFields } from '../../base44/functions/recoverLiveSyncLock/lock.ts';
import { assertMembershipProvenance } from '../../base44/functions/syncBillingSubscription/provenance.ts';
import { createRedisMock } from './_liveSyncRedisMock.ts';

const ORG = 'org';
const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const LOCK = lockKey(ORG), PENDING = pendingKey(ORG);
const member = { id: 'member', organization_id: ORG, google_sub: 'google', base44_user_id: 'native', active: true, role: 'owner' };
const price = { id: 'price_owner', livemode: true, currency: 'usd', unit_amount: 2900, type: 'recurring', recurring: { interval: 'month', interval_count: 1 }, billing_scheme: 'per_unit' };
const subscription = { id: 'sub_live', customer: 'cus_live', metadata: { org_id: ORG }, livemode: true, status: 'active', trial_start: null, trial_end: null, items: { has_more: false, data: [{ quantity: 1, price }] } };
const body = { mode: 'live', organization_id: ORG, subscription_id: 'sub_live' };
const preview = { mode: 'preview', organization_id: ORG };
const release = (owner: unknown) => ({ mode: 'release', organization_id: ORG, owner, confirm: `RELEASE ${ORG}` });

function world(opts: { failRpush?: boolean } = {}) {
  const mock = createRedisMock([
    ['trucky:billing:identity:v1:google', 'native'], ['trucky:billing:native:v1:native', 'google'],
    ['trucky:billing:member:v1:org:google', JSON.stringify({ orgId: ORG, googleSub: 'google', memberId: 'member', role: 'owner' })],
  ], opts);
  const org: any = { id: ORG, active: true, stripe_subscription_id: 'sub_test', plan_type: 'plan_29' };
  let now = T0;
  let n = 0;
  return {
    ...mock, org,
    clock: { advance: (ms: number) => { now += ms; } },
    syncDeps: (update: (id: string, f: any) => Promise<unknown>, over: Record<string, unknown> = {}) => ({
      enabled: true, orgIds: new Set([ORG]), memberIds: new Set(['member']), prices: { owner_op: 'price_owner', fleet: 'price_fleet' },
      redis: mock.cmd, assertProvenance: assertMembershipProvenance, owner: () => `uuid-${++n}`, now: () => now,
      organizations: async () => [org], members: async () => [{ ...member }],
      retrieve: async () => structuredClone(subscription), update, ...over,
    }),
    recDeps: (over: Partial<RecoverDeps> = {}): RecoverDeps => ({
      enabled: true, adminIds: new Set(['admin-1']), getCaller: async () => ({ id: 'admin-1', role: 'admin' }),
      redis: mock.cmd, organizations: async () => [org], now: () => now, ...over,
    }),
  };
}

/**
 * Escritura incierta: el lock y el pendiente quedan retenidos.
 * Devuelve el payload exacto que viajaba en la actualización, para poder
 * simular que esa misma escritura llega tarde.
 */
async function uncertainWrite(w: ReturnType<typeof world>, applied: boolean): Promise<Record<string, unknown>> {
  let sent: Record<string, unknown> = {};
  const r = await reconcileLiveSubscription(body, w.syncDeps(async (_id, f) => { sent = { ...f }; if (applied) Object.assign(w.org, f); throw new Error('timeout'); }));
  assertEquals(r.body.code, 'LIVE_WRITE_REQUIRES_REVIEW');
  assertEquals(w.store.has(LOCK) && w.store.has(PENDING), true);
  return sent;
}

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

Deno.test('«no aplicada todavía»: el preview lo informa sin escribir y NUNCA se libera, aunque pase un día', async () => {
  const w = world();
  await uncertainWrite(w, false);
  w.clock.advance(DAY);
  const before = w.writes.length;
  const p = await recoverLiveSyncLock(preview, w.recDeps());
  assertEquals([p.body.code, p.body.outcome, p.body.canRelease], ['RECOVERY_PREVIEW', 'WRITE_NOT_APPLIED_YET', false]);
  assertEquals(w.writes.length, before);
  const r = await recoverLiveSyncLock(release(p.body.owner), w.recDeps());
  assertEquals(r.body.code, 'WRITE_NOT_APPLIED_YET');
  assertEquals(w.store.has(LOCK) && w.store.has(PENDING), true);
  assertEquals(w.store.has(RECOVERY_AUDIT_KEY), false);
});

Deno.test('escritura tardía: mientras el lock se conserva, ninguna cancelación puede ser sobrescrita', async () => {
  const w = world();
  const inFlight = await uncertainWrite(w, false); // la escritura de `active` quedó en el aire
  w.clock.advance(DAY);
  // Mientras tanto Stripe cancela; una sincronización nueva no puede entrar.
  const blocked = await reconcileLiveSubscription(body, w.syncDeps(async (_id, f) => Object.assign(w.org, f), { retrieve: async () => ({ ...subscription, status: 'canceled' }) }));
  assertEquals(blocked.body.code, 'LIVE_RECONCILIATION_BUSY');
  // La escritura tardía de `active` finalmente se aplica…
  Object.assign(w.org, inFlight);
  // …ahora sí hay evidencia de finalización (id de operación + campos): se libera con auditoría.
  const p = await recoverLiveSyncLock(preview, w.recDeps());
  assertEquals(p.body.outcome, 'WRITE_APPLIED');
  assertEquals((await recoverLiveSyncLock(release(p.body.owner), w.recDeps())).body.code, 'LOCK_RELEASED');
  // La siguiente sincronización lee el estado canónico y deja `canceled`.
  const after = await reconcileLiveSubscription(body, w.syncDeps(async (_id, f) => Object.assign(w.org, f), { retrieve: async () => ({ ...subscription, status: 'canceled' }) }));
  assertEquals(after.body.code, 'SUBSCRIPTION_RECONCILED');
  assertEquals(w.org.stripe_live_subscription_status, 'canceled');
});

Deno.test('escritura aplicada (timeout después de escribir): se libera con auditoría atómica', async () => {
  const w = world();
  await uncertainWrite(w, true);
  w.clock.advance(MIN_LOCK_AGE_MS + 1000);
  const orgBefore = structuredClone(w.org);
  const p = await recoverLiveSyncLock(preview, w.recDeps());
  assertEquals([p.body.outcome, p.body.canRelease], ['WRITE_APPLIED', true]);
  const r = await recoverLiveSyncLock(release(p.body.owner), w.recDeps());
  assertEquals([r.body.code, r.body.outcome], ['LOCK_RELEASED', 'WRITE_APPLIED']);
  assertEquals(w.store.has(LOCK) || w.store.has(PENDING), false);
  assertEquals(w.org, orgBefore); // la recuperación nunca escribe en la organización
  const audit = w.store.get(RECOVERY_AUDIT_KEY).map((x: string) => JSON.parse(x));
  assertEquals(audit.length, 1);
  assertEquals([audit[0].event, audit[0].adminId, audit[0].orgId, audit[0].owner, audit[0].outcome], ['live_sync_lock_released', 'admin-1', ORG, p.body.owner, 'WRITE_APPLIED']);
});

Deno.test('si falla la auditoría, NO se libera: lock y pendiente intactos, sin registro', async () => {
  const w = world({ failRpush: true });
  await uncertainWrite(w, true);
  w.clock.advance(MIN_LOCK_AGE_MS + 1000);
  const owner = w.store.get(LOCK);
  const r = await recoverLiveSyncLock(release(owner), w.recDeps());
  assertEquals(r.body.code, 'RECOVERY_REQUIRES_REVIEW');
  assertEquals(w.store.get(LOCK), owner);
  assertEquals(w.store.has(PENDING), true);
  assertEquals(w.store.has(RECOVERY_AUDIT_KEY), false);
});

Deno.test('liberación: exige confirmación exacta, el mismo dueño revisado y la espera operativa', async () => {
  const w = world();
  await uncertainWrite(w, true);
  const owner = w.store.get(LOCK);
  assertEquals((await recoverLiveSyncLock(release(owner), w.recDeps())).body.code, 'LOCK_TOO_RECENT');
  w.clock.advance(MIN_LOCK_AGE_MS + 1000);
  assertEquals((await recoverLiveSyncLock({ mode: 'release', organization_id: ORG, owner }, w.recDeps())).body.code, 'CONFIRMATION_REQUIRED');
  assertEquals((await recoverLiveSyncLock(release('1:otro'), w.recDeps())).body.code, 'OWNER_MISMATCH');
  assertEquals(w.store.has(LOCK) && w.store.has(PENDING), true);
});

Deno.test('escritura PARCIAL o registro inconsistente → REVIEW_REQUIRED, nunca se libera', async () => {
  const w = world();
  await uncertainWrite(w, true);
  w.clock.advance(DAY);
  w.org.stripe_live_price_id = 'price_otro'; // está el id de la operación, pero un campo no coincide
  const r = await recoverLiveSyncLock(release(w.store.get(LOCK)), w.recDeps());
  assertEquals([r.body.code, r.body.outcome], ['REVIEW_REQUIRED', 'WRITE_PARTIAL']);
  assertEquals(w.store.has(LOCK) && w.store.has(PENDING), true);

  const w2 = world();
  await uncertainWrite(w2, true);
  w2.clock.advance(DAY);
  w2.store.set(PENDING, JSON.stringify({ ...JSON.parse(w2.store.get(PENDING)), owner: '1:otro' }));
  const r2 = await recoverLiveSyncLock(release(w2.store.get(LOCK)), w2.recDeps());
  assertEquals([r2.body.code, r2.body.outcome], ['REVIEW_REQUIRED', 'INCONSISTENT']);
});

Deno.test('before === fields: la igualdad de campos NO libera; la escritura tardía llega después de una cancelación y no la pisa', async () => {
  const w = world();
  // 1) Sincronización previa completa: la org ya está `active` con estos mismos campos.
  const ok = await reconcileLiveSubscription(body, w.syncDeps(async (_id, f) => Object.assign(w.org, f)));
  assertEquals(ok.body.code, 'SUBSCRIPTION_RECONCILED');
  const firstOp = w.org[OP_FIELD];
  // 2) Nueva sincronización idéntica: la escritura queda pendiente (timeout sin aplicarse).
  w.clock.advance(1000);
  const inFlight = await uncertainWrite(w, false);
  const pending = JSON.parse(w.store.get(PENDING));
  assertEquals(sameLiveFields(pending.before, pending.fields), true); // before === fields
  assertEquals(sameLiveFields(pickLiveFields(w.org), pending.fields), true); // la regla antigua habría liberado aquí
  assertEquals(w.org[OP_FIELD], firstOp); // pero el id visible es el de la operación ANTERIOR
  w.clock.advance(DAY);
  const p = await recoverLiveSyncLock(preview, w.recDeps());
  assertEquals([p.body.outcome, p.body.canRelease], ['WRITE_NOT_APPLIED_YET', false]);
  const r = await recoverLiveSyncLock(release(p.body.owner), w.recDeps());
  assertEquals(r.body.code, 'WRITE_NOT_APPLIED_YET');
  assertEquals(w.store.has(LOCK) && w.store.has(PENDING), true);
  assertEquals(w.store.has(RECOVERY_AUDIT_KEY), false);
  // 3) Stripe cancela: la sincronización de la cancelación no puede entrar mientras el lock siga.
  const cancel = { retrieve: async () => ({ ...subscription, status: 'canceled' }) };
  const blocked = await reconcileLiveSubscription(body, w.syncDeps(async (_id, f) => Object.assign(w.org, f), cancel));
  assertEquals(blocked.body.code, 'LIVE_RECONCILIATION_BUSY');
  assertEquals(w.org.stripe_live_subscription_status, 'active');
  // 4) La escritura tardía de `active` llega DESPUÉS de la cancelación: no pisa nada, porque la cancelación no se escribió.
  Object.assign(w.org, inFlight);
  const p2 = await recoverLiveSyncLock(preview, w.recDeps());
  assertEquals(p2.body.outcome, 'WRITE_APPLIED');
  assertEquals((await recoverLiveSyncLock(release(p2.body.owner), w.recDeps())).body.code, 'LOCK_RELEASED');
  // 5) Ahora sí se sincroniza la cancelación y queda como estado final.
  const after = await reconcileLiveSubscription(body, w.syncDeps(async (_id, f) => Object.assign(w.org, f), cancel));
  assertEquals(after.body.code, 'SUBSCRIPTION_RECONCILED');
  assertEquals(w.org.stripe_live_subscription_status, 'canceled');
});

Deno.test('atomicidad: los 5 campos live y el id de operación viajan en UNA sola actualización', async () => {
  const w = world();
  const calls: Array<[string, Record<string, unknown>]> = [];
  const r = await reconcileLiveSubscription(body, w.syncDeps(async (id, f) => { calls.push([id, { ...f }]); Object.assign(w.org, f); }));
  assertEquals(r.body.code, 'SUBSCRIPTION_RECONCILED');
  assertEquals(calls.length, 1);
  assertEquals(calls[0][0], ORG);
  assertEquals(Object.keys(calls[0][1]).sort(), [...LIVE_FIELDS, OP_FIELD].sort());
  // El id escrito es el token del dueño del lock que registró el pendiente.
  assertEquals(typeof calls[0][1][OP_FIELD], 'string');
  assertEquals(/^\d{10,16}:[A-Za-z0-9-]{1,64}$/.test(String(calls[0][1][OP_FIELD])), true);
});

Deno.test('esquema: Organization declara stripe_live_sync_operation_id', async () => {
  const raw = await Deno.readTextFile(new URL('../../base44/entities/Organization.jsonc', import.meta.url));
  const schema = JSON.parse(raw);
  assertEquals(schema.properties[OP_FIELD]?.type, 'string');
});

Deno.test('si el lock cambia de dueño entre la revisión y la liberación → LOCK_CHANGED, sin borrar ni auditar', async () => {
  const w = world();
  await uncertainWrite(w, true);
  w.clock.advance(DAY);
  const owner = w.store.get(LOCK);
  const racing = async (c: unknown[]) => { if (c[0] === 'EVAL') w.store.set(LOCK, '1:nuevo'); return w.cmd(c); };
  const r = await recoverLiveSyncLock(release(owner), w.recDeps({ redis: racing }));
  assertEquals(r.body.code, 'LOCK_CHANGED');
  assertEquals(w.store.get(LOCK), '1:nuevo');
  assertEquals(w.store.has(PENDING), true);
  assertEquals(w.store.has(RECOVERY_AUDIT_KEY), false);
});

Deno.test('sin escritura iniciada: se libera, y el proceso dueño ya no puede escribir después (fencing)', async () => {
  const w = world();
  let resume!: () => void;
  const paused = new Promise<void>((r) => { resume = r; });
  let wrote = false;
  // Proceso vivo que toma el lock y se detiene antes de registrar su escritura.
  const run = reconcileLiveSubscription(body, w.syncDeps(async () => { wrote = true; }, {
    retrieve: async () => { await paused; return structuredClone(subscription); },
  }));
  await new Promise((r) => setTimeout(r, 5));
  w.clock.advance(MIN_LOCK_AGE_MS + 1000);
  const p = await recoverLiveSyncLock(preview, w.recDeps());
  assertEquals([p.body.outcome, p.body.canRelease], ['NO_WRITE_STARTED', true]);
  assertEquals((await recoverLiveSyncLock(release(p.body.owner), w.recDeps())).body.code, 'LOCK_RELEASED');
  resume();
  const r = await run;
  assertEquals(r.body.code, 'LIVE_LOCK_LOST');
  assertEquals(wrote, false);
  assertEquals(w.store.has(PENDING), false);
});

Deno.test('sin escritura iniciada, pero aparece un pendiente justo antes de liberar → REVIEW_REQUIRED (comprobación atómica)', async () => {
  const w = world();
  w.store.set(LOCK, `${T0}:uuid-x`);
  w.clock.advance(DAY);
  const racing = async (c: unknown[]) => {
    if (c[0] === 'EVAL') w.store.set(PENDING, JSON.stringify({ owner: `${T0}:uuid-x`, orgId: ORG, fields: {}, before: {} }));
    return w.cmd(c);
  };
  const r = await recoverLiveSyncLock(release(`${T0}:uuid-x`), w.recDeps({ redis: racing }));
  assertEquals(r.body.code, 'REVIEW_REQUIRED');
  assertEquals(w.store.has(LOCK) && w.store.has(PENDING), true);
  assertEquals(w.store.has(RECOVERY_AUDIT_KEY), false);
});

Deno.test('sin bloqueo → NO_LOCK', async () => {
  const w = world();
  assertEquals((await recoverLiveSyncLock(preview, w.recDeps())).body.code, 'NO_LOCK');
});

Deno.test('lock.ts es idéntico en syncBillingSubscription y recoverLiveSyncLock', async () => {
  const a = await Deno.readTextFile(new URL('../../base44/functions/syncBillingSubscription/lock.ts', import.meta.url));
  const b = await Deno.readTextFile(new URL('../../base44/functions/recoverLiveSyncLock/lock.ts', import.meta.url));
  assertEquals(a, b);
});
