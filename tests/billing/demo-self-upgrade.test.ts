import { assertEquals } from 'jsr:@std/assert@1';
import { demoSelfUpgrade } from '../../base44/shared/demoSelfUpgrade.ts';
import { publicLandingAccount } from '../../base44/shared/publicLandingAccount.ts';

function setup(o: any = {}) {
  const kv = new Map<string, string>();
  const redis = async (c: any[]) => {
    const [cmd, ...a] = c;
    if (cmd === 'GET') return kv.get(a[0]) ?? null;
    if (cmd === 'EVAL') { const [, , k1, k2, v1, v2] = a; if (!kv.has(k1) && !kv.has(k2)) { kv.set(k1, v1); kv.set(k2, v2); return 1; } return kv.get(k1) === v1 ? 1 : 0; }
    return null;
  };
  const org = { id: 'org1', name: 'Demo Co', active: true, created_by_user: 'a@x.com', subscription_status: 'demo', ...o.org };
  const member = { id: 'mem1', organization_id: 'org1', user_email: 'a@x.com', role: 'owner', active: true, ...o.member };
  const updates: any[] = [];
  const db = {
    OrganizationMember: {
      filter: async (q: any) => q.organization_id ? (o.members ?? [member]) : (q.role ? [member].filter((m) => m.google_sub === q.google_sub) : [member]),
      update: async (id: string, f: any) => { updates.push([id, f]); Object.assign(member, f); },
    },
    Organization: { filter: async () => [org] },
  };
  return { kv, redis, db, updates, org, member };
}
const me = { sub: 'sub1', email: 'a@x.com' };

Deno.test('demo → pago: dueño único de su empresa demo puede pagar directo', async () => {
  const s = setup();
  const r = await demoSelfUpgrade(s.redis, s.db, me);
  assertEquals(r.ok, true);
  assertEquals(s.updates, [['mem1', { google_sub: 'sub1' }]]);
  // La elegibilidad la reconoce como cuenta que puede pagar sin vínculo previo.
  assertEquals(await publicLandingAccount(s.redis, s.org, s.member, async () => [s.member]), true);
});

Deno.test('demo → pago: demo vencido o cancelado también puede', async () => {
  assertEquals((await demoSelfUpgrade(setup({ org: { subscription_status: 'canceled' } }).redis, setup({ org: { subscription_status: 'canceled' } }).db, me)).ok, true);
});

Deno.test('demo → pago: NO si hay otros miembros, otro creador, otra cuenta de Google o ya está pagada', async () => {
  const otros = setup({ members: [{ id: 'mem1' }, { id: 'mem2' }] });
  assertEquals(await demoSelfUpgrade(otros.redis, otros.db, me), { ok: false, reason: 'OTHER_MEMBERS' });
  const creador = setup({ org: { created_by_user: 'jefe@x.com' } });
  assertEquals(await demoSelfUpgrade(creador.redis, creador.db, me), { ok: false, reason: 'NOT_CREATOR' });
  const google = setup({ member: { google_sub: 'otra' } });
  assertEquals(await demoSelfUpgrade(google.redis, google.db, me), { ok: false, reason: 'OTHER_GOOGLE_ACCOUNT' });
  const pagada = setup({ org: { subscription_status: 'active' } });
  assertEquals(await demoSelfUpgrade(pagada.redis, pagada.db, me), { ok: false, reason: 'ALREADY_SUBSCRIBED' });
});
