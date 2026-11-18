import { assertEquals } from 'jsr:@std/assert@1';
import { creationHash, repairLandingProvenance } from '../../base44/shared/landingRepair.ts';
import { publicLandingAccount } from '../../base44/shared/publicLandingAccount.ts';

const ORG = '6aac0718ff3a5154cb001234';
function setup(o: any = {}) {
  const kv = new Map<string, string>();
  const redis = async (c: any[]) => {
    const [cmd, ...a] = c;
    if (cmd === 'GET') return kv.get(a[0]) ?? null;
    if (cmd === 'SET') { kv.set(a[0], a[1]); return 'OK'; }
    if (cmd === 'EVAL') { const [, , k1, k2, v1, v2] = a; if (!kv.has(k1) && !kv.has(k2)) { kv.set(k1, v1); kv.set(k2, v2); return 1; } return 0; }
    return null;
  };
  const org = { id: ORG, name: 'Mi Empresa', active: true, ...o.org };
  const member = { id: 'mem_1', organization_id: ORG, google_sub: 'sub1', role: 'owner', active: true, ...o.member };
  const db = {
    OrganizationMember: { filter: async (q: any) => q.organization_id ? (o.members ?? [member]) : [member] },
    Organization: { filter: async () => [org] },
  };
  return { kv, redis, db, org, member };
}

Deno.test('recupera la empresa de la landing sin procedencia y la elegibilidad la acepta', async () => {
  const s = setup();
  s.kv.set(`trucky:billing:create:v1:attempt:${await creationHash('sub1', 'Mi Empresa')}`, 'owner-uuid-pendiente');
  const r = await repairLandingProvenance(s.redis, s.db, 'sub1', ORG);
  assertEquals(r.repaired, true);
  assertEquals(await publicLandingAccount(s.redis, s.org, s.member, async () => [s.member]), true);
});

Deno.test('también con la llave de creación del modo demo de la landing', async () => {
  const s = setup();
  s.kv.set(`trucky:demo:test:create:${await creationHash('sub1', 'Mi Empresa')}`, ORG);
  assertEquals((await repairLandingProvenance(s.redis, s.db, 'sub1')).repaired, true);
});

Deno.test('sin evidencia de la landing (empresa creada en la app) o con otros miembros → no se toca', async () => {
  const s = setup();
  assertEquals(await repairLandingProvenance(s.redis, s.db, 'sub1', ORG), { repaired: false, reason: 'NO_LANDING_EVIDENCE' });
  const t = setup({ members: [{ id: 'mem_1' }, { id: 'mem_2' }] });
  t.kv.set(`trucky:billing:create:v1:attempt:${await creationHash('sub1', 'Mi Empresa')}`, 'x');
  assertEquals((await repairLandingProvenance(t.redis, t.db, 'sub1', ORG)).repaired, false);
});
