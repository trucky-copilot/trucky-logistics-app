import { assertEquals } from 'jsr:@std/assert@1';
import { markOrganizationsDemo } from '../../base44/functions/activateDemoTrial/markDemo.ts';

Deno.test('demo: marca solo las empresas sin plan pagado', async () => {
  const orgs: Record<string, any> = { a: { id: 'a', subscription_status: 'none' }, b: { id: 'b', subscription_status: 'active' }, c: { id: 'c' } };
  const db = {
    OrganizationMember: { filter: async () => [{ organization_id: 'a' }, { organization_id: 'b' }, { organization_id: 'c' }] },
    Organization: { filter: async (q: any) => [orgs[q.id]], update: async (id: string, f: any) => Object.assign(orgs[id], f) },
  };
  assertEquals(await markOrganizationsDemo(db, 'X@x.com'), 2);
  assertEquals([orgs.a.subscription_status, orgs.b.subscription_status, orgs.c.subscription_status], ['demo', 'active', 'demo']);
});
