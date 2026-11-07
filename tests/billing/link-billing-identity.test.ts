// Pruebas de linkBillingIdentity (fase 1): piloto en el backend, verificación
// del token inyectada (en producción: firma con JWKS de Google, nunca tokeninfo
// en URL) y finalización idempotente ante resultados parciales.
import { assertEquals } from 'jsr:@std/assert@1';
import { linkBillingIdentityCore, type LinkDeps } from '../../base44/functions/linkBillingIdentity/link.ts';
import { assertMembershipProvenance, provenanceKey } from '../../base44/functions/linkBillingIdentity/provenance.mjs';
import { reserveNativeBinding } from '../../base44/functions/linkBillingIdentity/binding.mjs';

const ORG = 'org_1';
const SUB = 'google_1';
const member0 = { id: 'member_1', organization_id: ORG, google_sub: SUB, role: 'owner', active: true };
const proof = JSON.stringify({ memberId: 'member_1', orgId: ORG, googleSub: SUB, role: 'owner' });

function memRedis(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries({ [provenanceKey(ORG, SUB)]: proof, ...initial }));
  const cmd = async (c: unknown[]) => {
    const [op, a] = c as [string, string];
    if (op === 'GET') return store.get(a) ?? null;
    if (op === 'EVAL') {
      const [, , , fwd, rev, native, google] = c as string[];
      if ((store.has(fwd) && store.get(fwd) !== native) || (store.has(rev) && store.get(rev) !== google)) return 0;
      store.set(fwd, native); store.set(rev, google); return 1;
    }
    throw new Error('unexpected ' + op);
  };
  return { cmd, store };
}

function setup(over: Partial<LinkDeps> = {}, member: any = { ...member0 }) {
  const redis = memRedis();
  const deps: LinkDeps = {
    enabled: true,
    pilotOrgIds: new Set([ORG]),
    pilotMemberIds: new Set(['member_1']),
    getUser: async () => ({ id: 'native_1', email: 'Owner@testing.pro' }),
    verifyGoogleIdToken: async () => ({ sub: SUB, email: 'owner@testing.pro', email_verified: true }),
    redis: redis.cmd,
    findMembers: async () => [member],
    updateMember: async (_id, data) => Object.assign(member, data),
    assertProvenance: assertMembershipProvenance,
    reserveBinding: reserveNativeBinding,
    ...over,
  };
  return { deps, redis, member };
}
const body = { google_id_token: 'h.p.s', organization_id: ORG };

Deno.test('link: vinculación correcta → IDENTITY_LINKED', async () => {
  const s = setup();
  assertEquals((await linkBillingIdentityCore(body, s.deps)).code, 'IDENTITY_LINKED');
  assertEquals(s.member.base44_user_id, 'native_1');
});

Deno.test('link: piloto sin configurar, otra org u otra membresía → rechazado antes de verificar o escribir', async () => {
  let verified = false;
  const v = async () => { verified = true; return { sub: SUB, email: 'owner@testing.pro', email_verified: true }; };
  assertEquals((await linkBillingIdentityCore(body, setup({ pilotMemberIds: new Set(), verifyGoogleIdToken: v }).deps)).code, 'PILOT_NOT_CONFIGURED');
  assertEquals((await linkBillingIdentityCore({ ...body, organization_id: 'otra' }, setup({ verifyGoogleIdToken: v }).deps)).code, 'PILOT_NOT_ALLOWED');
  assertEquals(verified, false);
  assertEquals((await linkBillingIdentityCore(body, setup({ pilotMemberIds: new Set(['otro']) }).deps)).code, 'PILOT_NOT_ALLOWED');
});

Deno.test('link: token inválido o sin email verificado → GOOGLE_AUTHORIZATION_REQUIRED', async () => {
  assertEquals((await linkBillingIdentityCore(body, setup({ verifyGoogleIdToken: async () => { throw new Error('firma'); } }).deps)).code, 'GOOGLE_AUTHORIZATION_REQUIRED');
  assertEquals((await linkBillingIdentityCore(body, setup({ verifyGoogleIdToken: async () => ({ sub: SUB, email: 'owner@testing.pro', email_verified: false }) }).deps)).code, 'GOOGLE_AUTHORIZATION_REQUIRED');
});

Deno.test('link: identidad incorrecta → IDENTITY_MISMATCH sin escribir', async () => {
  const s = setup({ verifyGoogleIdToken: async () => ({ sub: SUB, email: 'otra@persona.com', email_verified: true }) });
  assertEquals((await linkBillingIdentityCore(body, s.deps)).code, 'IDENTITY_MISMATCH');
  assertEquals(s.member.base44_user_id, undefined);
});

Deno.test('link: parcial (Base44 falla) → LINK_COMPLETION_PENDING y resume lo completa', async () => {
  let fail = true;
  const member: any = { ...member0 };
  const s = setup({ updateMember: async (_id, data) => { if (fail) throw new Error('caído'); return Object.assign(member, data); } }, member);
  assertEquals((await linkBillingIdentityCore(body, s.deps)).code, 'LINK_COMPLETION_PENDING');
  assertEquals(s.redis.store.get(`trucky:billing:identity:v1:${SUB}`), 'native_1'); // no se borra
  fail = false;
  assertEquals((await linkBillingIdentityCore({ resume: true, confirm: true }, s.deps)).code, 'IDENTITY_LINKED');
  assertEquals(member.base44_user_id, 'native_1');
});

Deno.test('link: { resume } sin confirm:true → INVALID_REQUEST sin leer Redis ni escribir', async () => {
  let redisCalls = 0;
  let writes = 0;
  const s = setup({
    redis: async () => { redisCalls++; return null; },
    updateMember: async () => { writes++; return null; },
  });
  for (const b of [{ resume: true }, { resume: true, confirm: 'true' }, { resume: true, confirm: false }]) {
    const r = await linkBillingIdentityCore(b, s.deps);
    assertEquals([r.status, r.code], [400, 'INVALID_REQUEST']);
  }
  assertEquals(redisCalls, 0);
  assertEquals(writes, 0);
});

Deno.test('link: el código fuente ya no envía el token en una URL (sin tokeninfo)', async () => {
  for (const f of ['entry.ts', 'link.ts']) {
    const src = await Deno.readTextFile(new URL(`../../base44/functions/linkBillingIdentity/${f}`, import.meta.url));
    assertEquals(src.includes('tokeninfo'), false, f);
  }
  const entry = await Deno.readTextFile(new URL('../../base44/functions/linkBillingIdentity/entry.ts', import.meta.url));
  assertEquals(entry.includes('jwtVerify'), true);
});

Deno.test('pilot.ts es idéntico en redeemBillingLink y linkBillingIdentity', async () => {
  const a = await Deno.readTextFile(new URL('../../base44/functions/redeemBillingLink/pilot.ts', import.meta.url));
  const b = await Deno.readTextFile(new URL('../../base44/functions/linkBillingIdentity/pilot.ts', import.meta.url));
  assertEquals(a, b);
});
