import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

// Native Base44 session required. No user/role/subscription fields are accepted.
export default async function ensureOwnOrganization(req: Request, _ctx: unknown) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.id || !user?.email) return json({ error: 'UNAUTHORIZED' }, 401);
    const body = await req.json();
    const name = typeof body.company_name === 'string' ? body.company_name.trim() : '';
    if (name.length > 120) return json({ error: 'INVALID_NAME' }, 400);
    const db = base44.asServiceRole.entities;
    const owned = await db.Organization.filter({ created_by_user: user.email });
    let org = owned?.[0];
    if (!org) {
      org = await db.Organization.create({
        name: name || user.full_name || user.email,
        created_by_user: user.email,
        workspace_status: 'setup', onboarding_completed: false,
        production_ready: false, active: true, subscription_status: 'none',
      });
    }
    // Only the creator authenticated through Base44 may repair this membership.
    const members = await db.OrganizationMember.filter({ organization_id: org.id, user_email: user.email });
    if (!members?.length) {
      await db.OrganizationMember.create({ organization_id: org.id, user_email: user.email, role: 'owner', active: true });
    }
    return json({ organization: { id: org.id, name: org.name } });
  } catch {
    return json({ error: 'ORGANIZATION_SETUP_FAILED' }, 503);
  }
}
