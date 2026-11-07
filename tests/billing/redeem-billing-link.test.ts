// Pruebas de redeemBillingLink (fase 1: solo vinculación de identidades).
// Cubren identidad incorrecta, expiración, reutilización y vinculación
// idempotente con Redis y Base44 simulados. Usa los validadores reales de
// procedencia y del vínculo atómico (copias .mjs idénticas a las .ts).
import { assertEquals } from 'jsr:@std/assert@1';
import { redeemBillingLinkCore, HANDOFF_PREFIX, type RedeemDeps } from '../../base44/functions/redeemBillingLink/redeem.ts';
import { assertMembershipProvenance, provenanceKey } from '../../base44/functions/redeemBillingLink/provenance.mjs';
import { reserveNativeBinding } from '../../base44/functions/redeemBillingLink/binding.mjs';

const CODE = 'a'.repeat(64);
const HASH = 'h'.repeat(8);
const ORG = 'org_1';
const SUB = 'google_1';
const USER = { id: 'native_1', email: 'Owner@Testing.pro' };
const ticket = JSON.stringify({ sub: SUB, email: 'owner@testing.pro', orgId: ORG });
const baseMember = { id: 'member_1', organization_id: ORG, google_sub: SUB, role: 'owner', active: true };
const proof = JSON.stringify({ memberId: 'member_1', orgId: ORG, googleSub: SUB, role: 'owner' });

function memRedis(initial: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial));
  const cmd = async (c: unknown[]) => {
    const [op, a] = c as [string, string];
    if (op === 'GET') return store.get(a) ?? null;
    if (op === 'GETDEL') { const v = store.get(a) ?? null; store.delete(a); return v; }
    if (op === 'EVAL') {
      const [, , , fwd, rev, native, google] = c as string[];
      if ((store.has(fwd) && store.get(fwd) !== native) || (store.has(rev) && store.get(rev) !== google)) return 0;
      store.set(fwd, native); store.set(rev, google); return 1;
    }
    throw new Error('unexpected ' + op);
  };
  return { cmd, store };
}

function setup(over: Partial<RedeemDeps> = {}, member: any = { ...baseMember }, extra: Record<string, string> = {}) {
  const redis = memRedis({ [HANDOFF_PREFIX + HASH]: ticket, [provenanceKey(ORG, SUB)]: proof, ...extra });
  const updates: unknown[] = [];
  const deps: RedeemDeps = {
    enabled: true,
    getUser: async () => USER,
    redis: redis.cmd,
    findMembers: async () => [member],
    updateMember: async (id, data) => { updates.push([id, data]); Object.assign(member, data); return member; },
    assertProvenance: assertMembershipProvenance,
    reserveBinding: reserveNativeBinding,
    sha256Hex: async () => HASH,
    ...over,
  };
  return { deps, redis, updates, member };
}
const body = { code: CODE, confirm: true };

Deno.test('vinculación correcta: IDENTITY_LINKED, consume el ticket y guarda el usuario nativo', async () => {
  const s = setup();
  assertEquals((await redeemBillingLinkCore(body, s.deps)).code, 'IDENTITY_LINKED');
  assertEquals(s.redis.store.has(HANDOFF_PREFIX + HASH), false);
  assertEquals(s.updates, [['member_1', { base44_user_id: 'native_1' }]]);
  assertEquals(s.redis.store.get(`trucky:billing:identity:v1:${SUB}`), 'native_1');
});

Deno.test('identidad incorrecta: otra cuenta nativa → IDENTITY_MISMATCH y el ticket NO se consume', async () => {
  const s = setup({ getUser: async () => ({ id: 'native_x', email: 'otra@persona.com' }) });
  const res = await redeemBillingLinkCore(body, s.deps);
  assertEquals([res.status, res.code], [403, 'IDENTITY_MISMATCH']);
  assertEquals(s.redis.store.has(HANDOFF_PREFIX + HASH), true);
  assertEquals(s.updates.length, 0);
});

Deno.test('expiración: ticket inexistente o vencido → LINK_EXPIRED, sin cambios', async () => {
  const s = setup();
  s.redis.store.delete(HANDOFF_PREFIX + HASH);
  const res = await redeemBillingLinkCore(body, s.deps);
  assertEquals([res.status, res.code], [409, 'LINK_EXPIRED']);
  assertEquals(s.updates.length, 0);
});

Deno.test('reutilización: el mismo enlace por segunda vez no vuelve a vincular', async () => {
  const s = setup();
  assertEquals((await redeemBillingLinkCore(body, s.deps)).code, 'IDENTITY_LINKED');
  assertEquals((await redeemBillingLinkCore(body, s.deps)).code, 'LINK_EXPIRED');
  assertEquals(s.updates.length, 1);
});

Deno.test('reutilización simultánea: si otro consumió el ticket entre GET y GETDEL → LINK_ALREADY_USED', async () => {
  const s = setup();
  const racing = async (c: unknown[]) => {
    if (c[0] === 'GETDEL') { s.redis.store.delete(c[1] as string); return null; }
    return s.redis.cmd(c);
  };
  const res = await redeemBillingLinkCore(body, { ...s.deps, redis: racing });
  assertEquals([res.status, res.code], [409, 'LINK_ALREADY_USED']);
  assertEquals(s.updates.length, 0);
});

Deno.test('idempotente: un enlace nuevo para la misma cuenta ya vinculada vuelve a dar IDENTITY_LINKED sin reescribir', async () => {
  const member = { ...baseMember, base44_user_id: 'native_1' };
  const s = setup({}, member, {
    [`trucky:billing:identity:v1:${SUB}`]: 'native_1',
    [`trucky:billing:native:v1:native_1`]: SUB,
  });
  assertEquals((await redeemBillingLinkCore(body, s.deps)).code, 'IDENTITY_LINKED');
  assertEquals(s.updates.length, 0);
});

Deno.test('membresía ya vinculada a OTRO usuario nativo → IDENTITY_ALREADY_BOUND', async () => {
  const s = setup({}, { ...baseMember, base44_user_id: 'native_otro' });
  const res = await redeemBillingLinkCore(body, s.deps);
  assertEquals([res.status, res.code], [409, 'IDENTITY_ALREADY_BOUND']);
  assertEquals(s.updates.length, 0);
});

Deno.test('Google ya vinculado a otro usuario nativo en el registro atómico → no vincula', async () => {
  const s = setup({}, { ...baseMember }, { [`trucky:billing:identity:v1:${SUB}`]: 'native_otro' });
  assertEquals((await redeemBillingLinkCore(body, s.deps)).code, 'LINK_REQUIRES_REVIEW');
  assertEquals(s.updates.length, 0);
});

Deno.test('sin prueba de procedencia → no vincula', async () => {
  const s = setup();
  s.redis.store.delete(provenanceKey(ORG, SUB));
  assertEquals((await redeemBillingLinkCore(body, s.deps)).code, 'LINK_REQUIRES_REVIEW');
  assertEquals(s.updates.length, 0);
});

Deno.test('sin sesión, sin confirmación, código malformado o apagado → rechazado sin tocar Redis', async () => {
  let touched = false;
  const spy = async () => { touched = true; return null; };
  assertEquals((await redeemBillingLinkCore(body, { ...setup().deps, redis: spy, getUser: async () => null })).code, 'NATIVE_SESSION_REQUIRED');
  assertEquals((await redeemBillingLinkCore({ code: CODE }, { ...setup().deps, redis: spy })).code, 'INVALID_REQUEST');
  assertEquals((await redeemBillingLinkCore({ code: 'xyz', confirm: true }, { ...setup().deps, redis: spy })).code, 'INVALID_REQUEST');
  assertEquals((await redeemBillingLinkCore(body, { ...setup().deps, redis: spy, enabled: false })).code, 'LINK_NOT_ENABLED');
  assertEquals(touched, false);
});

Deno.test('varias membresías activas para el mismo Google → VERIFIED_MEMBERSHIP_REQUIRED', async () => {
  const s = setup({ findMembers: async () => [baseMember, { ...baseMember, id: 'member_2' }] });
  assertEquals((await redeemBillingLinkCore(body, s.deps)).code, 'VERIFIED_MEMBERSHIP_REQUIRED');
});
