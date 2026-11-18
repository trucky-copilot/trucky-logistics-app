import { assertEquals } from 'jsr:@std/assert@1';
import { creationHash, repairHalfCreatedLanding } from '../../base44/functions/createOrganizationForUser/repairLanding.ts';

const ORG = 'org_landing_1';
function setup(over: any = {}) {
  const kv = new Map<string, string>();
  const redis = async (c: any[]) => {
    const [cmd, ...a] = c;
    if (cmd === 'GET') return kv.get(a[0]) ?? null;
    if (cmd === 'SET') { kv.set(a[0], a[1]); return 'OK'; }
    if (cmd === 'EVAL') { // REGISTER_ENROLLMENT simplificado: MSET si no existen
      const [, , k1, k2, v1, v2] = a; if (!kv.has(k1) && !kv.has(k2)) { kv.set(k1, v1); kv.set(k2, v2); } return 1;
    }
    return null;
  };
  const org = { id: ORG, name: 'Mi Empresa', active: true, created_by_user: 'a@x.com', ...over.org };
  const member = { id: 'mem_1', organization_id: ORG, user_email: 'a@x.com', google_sub: 'sub1', role: 'owner', active: true, ...over.member };
  const members = over.members ?? [member];
  const db = {
    OrganizationMember: { filter: async (q: any) => q.organization_id ? members : [member] },
    Organization: { filter: async () => [org] },
  };
  return { kv, redis, db };
}

Deno.test('reparación: empresa de la landing a medias → completa procedencia y sigue', async () => {
  const s = setup();
  s.kv.set(`trucky:billing:create:v1:attempt:${await creationHash('sub1', 'Mi Empresa')}`, 'pending-owner-uuid');
  const r = await repairHalfCreatedLanding(s.redis, s.db, { sub: 'sub1', email: 'a@x.com' });
  assertEquals(r.repaired, true);
  assertEquals(s.kv.has(`trucky:billing:member:v1:${ORG}:sub1`), true);
  assertEquals(s.kv.has(`trucky:billing:enrollment:v1:org:${ORG}`), true);
});

Deno.test('reparación: sin evidencia de la landing (empresa creada en la app) → no se toca', async () => {
  const s = setup();
  const r = await repairHalfCreatedLanding(s.redis, s.db, { sub: 'sub1', email: 'a@x.com' });
  assertEquals(r, { repaired: false, reason: 'NO_LANDING_EVIDENCE' });
});

Deno.test('reparación: empresa con otros miembros o de otro correo → no se toca', async () => {
  const s = setup({ members: [{ id: 'mem_1' }, { id: 'mem_2' }] });
  s.kv.set(`trucky:billing:create:v1:attempt:${await creationHash('sub1', 'Mi Empresa')}`, 'x');
  assertEquals((await repairHalfCreatedLanding(s.redis, s.db, { sub: 'sub1', email: 'a@x.com' })).repaired, false);
  const t = setup({ org: { created_by_user: 'otro@x.com' } });
  assertEquals((await repairHalfCreatedLanding(t.redis, t.db, { sub: 'sub1', email: 'a@x.com' })).repaired, false);
});
