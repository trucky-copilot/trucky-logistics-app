import {
  route, expectedProvenance, TARGET_ORG_ID, TARGET_MEMBER_ID, CONFIRMATION_PHRASE,
  DONE_KEY, AUDIT_KEY, APPROVAL_KEY, APPROVAL_TTL_SECONDS, type MigrationDeps,
} from './migration.ts';
import { provenanceKey, assertMembershipProvenance } from './provenance.ts';

function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg: string) { if (a !== b) throw new Error(`${msg}: ${a} !== ${b}`); }

const SUB = '108012345678901234567';
const NOW = 1_800_000_000_000;
const TOKEN = 'header.payload.signature-SECRET';
const member = { id: TARGET_MEMBER_ID, organization_id: TARGET_ORG_ID, google_sub: SUB, role: 'owner', active: true, user_email: 'owner@testing.pro' };
const org = { id: TARGET_ORG_ID, active: true, created_by_user: 'owner@testing.pro' };
const KEY = provenanceKey(TARGET_ORG_ID, SUB);

function memRedis(initial: Record<string, string> = {}) {
  const store = new Map<string, any>(Object.entries(initial));
  const ttl = new Map<string, number>();
  const writes: unknown[][] = [];
  const cmd = async (c: unknown[]) => {
    const [op, key, val] = c as [string, string, string];
    if (op === 'GET') return store.get(key) ?? null;
    writes.push(c);
    if (op === 'GETDEL') { const v = store.get(key) ?? null; store.delete(key); return v; }
    if (op === 'SET') {
      const nx = c.includes('NX'); const exIdx = c.indexOf('EX');
      if (nx && store.has(key)) return null;
      store.set(key, val); if (exIdx > 0) ttl.set(key, Number(c[exIdx + 1]));
      return 'OK';
    }
    if (op === 'RPUSH') { const l = store.get(key) ?? []; l.push(val); store.set(key, l); return l.length; }
    throw new Error('unexpected ' + op);
  };
  return { cmd, store, ttl, writes };
}

type D = MigrationDeps & { _r: ReturnType<typeof memRedis> };
function deps(over: Partial<MigrationDeps> = {}, redis = memRedis()): D {
  return {
    enabled: true,
    allowedAdminIds: new Set(['admin-1']),
    isTrustedServer: () => true,
    getCaller: async () => ({ id: 'admin-1', role: 'admin' }),
    verifyGoogleIdToken: async () => ({ sub: SUB, email: 'owner@testing.pro', email_verified: true, iat: NOW / 1000 - 30 }),
    getMember: async () => ({ ...member }),
    getOrganization: async () => ({ ...org }),
    listActiveOwners: async () => [{ ...member }],
    redis: redis.cmd,
    now: () => NOW,
    newId: () => 'approval-1',
    ...over,
    _r: redis,
  };
}
const approvalBody = (over: Record<string, unknown> = {}) => ({
  mode: 'owner_approval', organization_id: TARGET_ORG_ID, member_id: TARGET_MEMBER_ID, google_id_token: TOKEN, owner_consent: true, ...over,
});
const adminBody = (over: Record<string, unknown> = {}) => ({
  mode: 'preview', organization_id: TARGET_ORG_ID, member_id: TARGET_MEMBER_ID, ...over,
});
const execute = (over: Record<string, unknown> = {}) => adminBody({ mode: 'execute', confirm: CONFIRMATION_PHRASE, ...over });
async function approved(d: D) { eq((await route(approvalBody(), d)).code, 'OWNER_APPROVAL_RECORDED', 'aprobación'); }

// ── Generales ────────────────────────────────────────────────────────────────
Deno.test('apagada por defecto: ni aprobación ni ejecución', async () => {
  const d = deps({ enabled: false });
  eq((await route(approvalBody(), d)).code, 'MIGRATION_DISABLED', 'aprobación');
  eq((await route(execute(), d)).code, 'MIGRATION_DISABLED', 'ejecución');
  eq(d._r.writes.length, 0, 'sin escrituras');
});

// ── Paso 1: aprobación del titular (servidor-a-servidor) ─────────────────────
Deno.test('aprobación: solo con el secreto servidor-a-servidor', async () => {
  const d = deps({ isTrustedServer: () => false });
  eq((await route(approvalBody(), d)).code, 'SERVER_AUTH_REQUIRED', 's2s');
  eq(d._r.writes.length, 0, 'sin escrituras');
});

Deno.test('aprobación: exige consentimiento explícito y el objetivo fijo', async () => {
  eq((await route(approvalBody({ owner_consent: 'yes' }), deps())).code, 'OWNER_CONSENT_REQUIRED', 'consentimiento');
  eq((await route(approvalBody({ organization_id: 'otra' }), deps())).code, 'TARGET_NOT_ALLOWED', 'org');
  eq((await route(approvalBody({ member_id: 'otra' }), deps())).code, 'TARGET_NOT_ALLOWED', 'membresía');
});

Deno.test('aprobación: token inválido, sin email verificado o no reciente → rechazado', async () => {
  eq((await route(approvalBody(), deps({ verifyGoogleIdToken: async () => { throw new Error('firma'); } }))).code, 'GOOGLE_AUTHORIZATION_REQUIRED', 'firma');
  eq((await route(approvalBody(), deps({ verifyGoogleIdToken: async () => ({ sub: SUB, email: 'owner@testing.pro', email_verified: false, iat: NOW / 1000 }) }))).code, 'GOOGLE_AUTHORIZATION_REQUIRED', 'email');
  eq((await route(approvalBody(), deps({ verifyGoogleIdToken: async () => ({ sub: SUB, email: 'owner@testing.pro', email_verified: true, iat: NOW / 1000 - 3600 }) }))).code, 'GOOGLE_TOKEN_NOT_RECENT', 'viejo');
});

Deno.test('aprobación: sub distinto bloquea aunque el correo coincida; sin google_sub bloquea y no lo asigna', async () => {
  const r1 = await route(approvalBody(), deps({ verifyGoogleIdToken: async () => ({ sub: '999', email: 'owner@testing.pro', email_verified: true, iat: NOW / 1000 }) }));
  assert(r1.code.includes('verified_sub_matches_member'), r1.code);
  const r2 = await route(approvalBody(), deps({ getMember: async () => ({ ...member, google_sub: undefined }) }));
  assert(r2.code.includes('member_has_google_sub'), r2.code);
});

Deno.test('aprobación: propiedad (rol, activa, creador, varios dueños)', async () => {
  assert((await route(approvalBody(), deps({ getMember: async () => ({ ...member, role: 'member' }) }))).code.includes('member_is_active_owner'), 'rol');
  assert((await route(approvalBody(), deps({ getMember: async () => ({ ...member, active: false }) }))).code.includes('member_is_active_owner'), 'activa');
  assert((await route(approvalBody(), deps({ getOrganization: async () => ({ ...org, created_by_user: 'x@y.z' }) }))).code.includes('org_creator_is_member'), 'creador');
  assert((await route(approvalBody(), deps({ listActiveOwners: async () => [member, { id: 'otro' }] }))).code.includes('single_active_owner_is_member'), 'dueños');
});

Deno.test('aprobación: guarda identidad y membresía con vencimiento, SIN el token', async () => {
  const d = deps();
  await approved(d);
  const saved = String(d._r.store.get(APPROVAL_KEY));
  const a = JSON.parse(saved);
  eq(a.googleSub, SUB, 'sub'); eq(a.orgId, TARGET_ORG_ID, 'org'); eq(a.memberId, TARGET_MEMBER_ID, 'membresía');
  eq(d._r.ttl.get(APPROVAL_KEY), APPROVAL_TTL_SECONDS, 'vence');
  assert(!saved.includes('SECRET') && !JSON.stringify(d._r.store.get(AUDIT_KEY)).includes('SECRET'), 'sin token');
  eq((await route(approvalBody(), d)).code, 'APPROVAL_ALREADY_PENDING', 'no se reemplaza una aprobación vigente');
});

// ── Paso 2: administrador ────────────────────────────────────────────────────
Deno.test('admin: solo admin autorizado en la lista del servidor', async () => {
  eq((await route(adminBody(), deps({ getCaller: async () => null }))).code, 'ADMIN_SESSION_REQUIRED', 'sesión');
  eq((await route(adminBody(), deps({ getCaller: async () => ({ id: 'u-9', role: 'user' }) }))).code, 'ADMIN_NOT_AUTHORIZED', 'rol');
  eq((await route(adminBody(), deps({ getCaller: async () => ({ id: 'admin-2', role: 'admin' }) }))).code, 'ADMIN_NOT_AUTHORIZED', 'lista');
});

Deno.test('admin: nunca acepta un token pegado', async () => {
  const d = deps(); await approved(d);
  eq((await route(adminBody({ google_id_token: TOKEN }), d)).code, 'TOKEN_NOT_ACCEPTED_FROM_ADMIN', 'token');
});

Deno.test('admin: sin aprobación vigente del titular no avanza (vencida = no existe)', async () => {
  eq((await route(adminBody(), deps())).code, 'OWNER_APPROVAL_REQUIRED', 'preview');
  eq((await route(execute(), deps())).code, 'OWNER_APPROVAL_REQUIRED', 'execute');
});

Deno.test('admin: no se puede cambiar organización ni membresía', async () => {
  const d = deps(); await approved(d);
  eq((await route(adminBody({ organization_id: 'otra' }), d)).code, 'TARGET_NOT_ALLOWED', 'org');
  eq((await route(adminBody({ member_id: 'otra' }), d)).code, 'TARGET_NOT_ALLOWED', 'membresía');
});

Deno.test('admin: si la membresía cambió de sub tras la aprobación, bloquea', async () => {
  const d = deps(); await approved(d);
  const d2 = deps({ getMember: async () => ({ ...member, google_sub: '999' }) }, d._r);
  assert((await route(adminBody(), d2)).code.includes('verified_sub_matches_member'), 'sub cambiado');
});

Deno.test('preview: revisa todo y NO escribe ni consume la aprobación', async () => {
  const d = deps(); await approved(d);
  const before = d._r.writes.length;
  const r = await route(adminBody(), d);
  eq(r.code, 'READY', 'listo'); eq(r.wouldWrite, true, 'escribiría');
  eq(d._r.writes.length, before, 'sin escrituras');
  assert(d._r.store.has(APPROVAL_KEY), 'aprobación intacta');
});

Deno.test('execute sin la frase exacta: no escribe ni consume la aprobación', async () => {
  const d = deps(); await approved(d);
  const before = d._r.writes.length;
  eq((await route(execute({ confirm: 'si' }), d)).code, 'CONFIRMATION_REQUIRED', 'confirmación');
  eq(d._r.writes.length, before, 'sin escrituras');
});

Deno.test('execute: consume la aprobación, SET NX en formato exacto, audita sin token y se deshabilita', async () => {
  const d = deps(); await approved(d);
  eq((await route(execute(), d)).code, 'PROVENANCE_WRITTEN', 'escrita');
  const set = d._r.writes.find((w) => w[0] === 'SET' && w[1] === KEY)!;
  assert(set.includes('NX'), 'NX'); eq(set[2], expectedProvenance(member), 'formato');
  await assertMembershipProvenance(d._r.cmd, member);
  assert(!d._r.store.has(APPROVAL_KEY), 'aprobación consumida');
  assert(!JSON.stringify(d._r.store.get(AUDIT_KEY)).includes('SECRET'), 'auditoría sin token');
  assert(d._r.store.has(DONE_KEY), 'terminada');
  eq((await route(execute(), d)).code, 'MIGRATION_ALREADY_COMPLETED', 'admin no repite');
  eq((await route(approvalBody(), d)).code, 'MIGRATION_ALREADY_COMPLETED', 'tampoco nueva aprobación');
});

Deno.test('execute: la aprobación se consume una sola vez (dos ejecuciones simultáneas)', async () => {
  const d = deps(); await approved(d);
  const raw = d._r.store.get(APPROVAL_KEY);
  d._r.store.delete(APPROVAL_KEY); // otra ejecución la consumió entre preview y GETDEL
  const racing = async (c: unknown[]) => (c[0] === 'GET' && c[1] === APPROVAL_KEY ? raw : d._r.cmd(c));
  eq((await route(execute(), deps({ redis: racing }, d._r))).code, 'OWNER_APPROVAL_CHANGED', 'una sola vez');
  assert(!d._r.store.has(KEY), 'no escribió');
});

Deno.test('ya existe y coincide → idempotente; difiere → bloquea sin sobrescribir', async () => {
  const ok = deps({}, memRedis({ [KEY]: expectedProvenance(member) })); await approved(ok);
  eq((await route(adminBody(), ok)).code, 'ALREADY_PRESENT', 'preview');
  eq((await route(execute(), ok)).code, 'ALREADY_PRESENT', 'execute');
  assert(!ok._r.writes.some((w) => w[0] === 'SET' && w[1] === KEY), 'no reescribe');

  const otra = JSON.stringify({ memberId: 'otro', orgId: TARGET_ORG_ID, googleSub: SUB, role: 'owner' });
  const bad = deps({}, memRedis({ [KEY]: otra })); await approved(bad);
  eq((await route(execute(), bad)).code, 'PROVENANCE_CONFLICT', 'conflicto');
  eq(bad._r.store.get(KEY), otra, 'intacto'); assert(!bad._r.store.has(DONE_KEY), 'no terminada');
});

Deno.test('carrera: otra escritura distinta llega primero → bloquea sin sobrescribir', async () => {
  const d = deps(); await approved(d);
  const otra = JSON.stringify({ memberId: 'otro', orgId: TARGET_ORG_ID, googleSub: SUB, role: 'owner' });
  let first = true;
  const racing = async (c: unknown[]) => {
    if (c[0] === 'SET' && c[1] === KEY && first) { first = false; d._r.store.set(KEY, otra); return null; }
    return d._r.cmd(c);
  };
  eq((await route(execute(), deps({ redis: racing }, d._r))).code, 'PROVENANCE_CONFLICT', 'carrera');
  eq(d._r.store.get(KEY), otra, 'no sobrescribe');
});
