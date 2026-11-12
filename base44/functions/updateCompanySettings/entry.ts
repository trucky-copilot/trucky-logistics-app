// F3-15 · Fase 3 — Guarda el nombre de la empresa y sus tipos de camión.
// Organization solo la puede editar el servidor (RLS de admin), así que esta
// función valida que quien pide el cambio sea owner/admin activo de ESA
// organización. El cambio de nombre exige confirmar_nombre=true (sin historial);
// también se copia al CarrierProfile de la
// organización (es el nombre contra el que compara el verificador, F4-07).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { logAndSanitizeError } from '../../shared/safeError.ts';
import { EDIT_ROLES, planCompanyChange } from '../../shared/companySettings.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const view = (o: any) => ({ id: o.id, name: o.name, tipos_camion: o.tipos_camion || [] });

Deno.serve(async (req: Request) => {
  try {
    const base44 = createClientFromRequest(req);
    let user: any = null;
    try { user = await base44.auth.me(); } catch { /* sin sesión */ }
    const email = String(user?.email || '').toLowerCase();
    if (!email) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const orgId = typeof body?.organization_id === 'string' ? body.organization_id : '';
    if (!orgId) return json({ error: 'Falta organization_id' }, 400);

    const db = base44.asServiceRole.entities;
    // El correo puede estar guardado con mayúsculas: se compara sin distinguirlas.
    const members = await db.OrganizationMember.filter({ organization_id: orgId, active: true });
    const member = (members || []).find((m: any) => String(m.user_email || '').toLowerCase() === email);
    if (!member) return json({ error: 'Forbidden' }, 403);

    const org = (await db.Organization.filter({ id: orgId }))?.[0];
    if (!org || org.active === false) return json({ error: 'La empresa no existe o está inactiva', code: 'ORG_NOT_FOUND' }, 404);

    // Solo lectura: cualquier miembro activo puede consultar.
    if (body?.accion === 'leer') return json({ ok: true, organization: view(org), puede_editar: EDIT_ROLES.includes(member.role) });

    if (!EDIT_ROLES.includes(member.role)) return json({ error: 'Solo el dueño o un administrador de la empresa puede cambiar estos datos' }, 403);

    const plan = planCompanyChange(org, body);
    if (!plan.ok) return json({ error: plan.error, requiere_confirmacion: plan.requiere_confirmacion || undefined }, plan.status);

    await db.Organization.update(org.id, plan.orgPatch);
    if (plan.carrierPatch) {
      const cps = await db.CarrierProfile.filter({ organization_id: org.id });
      for (const cp of cps || []) await db.CarrierProfile.update(cp.id, plan.carrierPatch);
    }
    const after = (await db.Organization.filter({ id: org.id }))?.[0] || { ...org, ...plan.orgPatch };
    return json({ ok: true, organization: view(after), cambio_nombre: plan.cambioNombre });
  } catch (error) {
    return json(logAndSanitizeError('updateCompanySettings', error), 500);
  }
});
