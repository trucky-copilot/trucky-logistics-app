import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { demoRedis } from './demoRegistry.ts';
import { probeUpdateMany } from './probe.ts';
/**
 * probeMembershipUpdateMany — TEMPORAL. Prueba con rol de servicio la semántica
 * de updateMany sobre UNA membresía de prueba y la restaura (ver probe.ts).
 * Variables (apagada por defecto):
 *  MEMBERSHIP_UPDATE_PROBE_ENABLED, MEMBERSHIP_UPDATE_PROBE_ADMIN_IDS,
 *  MEMBERSHIP_UPDATE_PROBE_MEMBER_ID, MEMBERSHIP_UPDATE_PROBE_ORG_ID.
 * Rechaza miembros/orgs del piloto y organizaciones registradas.
 */
const ids = (v: string | undefined) => new Set((v || '').split(',').map((s) => s.trim()).filter(Boolean));
export default async function handler(req: Request, _ctx: unknown) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (req.method !== 'POST') return new Response(JSON.stringify({ code: 'METHOD_NOT_ALLOWED' }), { status: 405, headers });
  if (Deno.env.get('MEMBERSHIP_UPDATE_PROBE_ENABLED') !== 'true') return new Response(JSON.stringify({ code: 'PROBE_DISABLED' }), { status: 503, headers });
  try {
    let body: unknown = null;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ code: 'INVALID_REQUEST' }), { status: 400, headers }); }
    const client = createClientFromRequest(req);
    const db = client.asServiceRole.entities;
    const r = await probeUpdateMany(body, {
      enabled: true,
      adminIds: ids(Deno.env.get('MEMBERSHIP_UPDATE_PROBE_ADMIN_IDS')),
      memberId: Deno.env.get('MEMBERSHIP_UPDATE_PROBE_MEMBER_ID'),
      orgId: Deno.env.get('MEMBERSHIP_UPDATE_PROBE_ORG_ID'),
      pilotOrgIds: ids(Deno.env.get('BILLING_LINK_PILOT_ORG_IDS')),
      pilotMemberIds: ids(Deno.env.get('BILLING_LINK_PILOT_MEMBER_IDS')),
      user: () => client.auth.me(),
      read: async (id) => (await db.OrganizationMember.filter({ id }))?.[0] ?? null,
      updateMany: (query, data) => db.OrganizationMember.updateMany(query, data as any),
      redis: demoRedis,
      runId: () => crypto.randomUUID(),
    });
    return new Response(JSON.stringify(r.body), { status: r.status, headers });
  } catch {
    return new Response(JSON.stringify({ code: 'PROBE_REQUIRES_REVIEW' }), { status: 503, headers });
  }
}
