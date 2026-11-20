// F3-15 · Fase 6 — "Solicitar eliminación de cuenta". NO borra datos: registra
// la solicitud (AccountDeletionRequest, solo la crea el servidor) y avisa por
// correo a soporte, que la revisa con el usuario y la ejecuta.
// Acciones: { accion: 'estado' } → solicitud pendiente del usuario (si hay);
//           { confirmacion: 'ELIMINAR'|'DELETE', motivo? } → crea la solicitud.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { validarSolicitud, mensajeSoporte, SUPPORT_EMAIL_DEFAULT } from './deletionRequest.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const vista = (r: any) => r ? { estado: r.estado, solicitado_at: r.solicitado_at } : null;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const base44 = createClientFromRequest(req);
    let user: any = null;
    try { user = await base44.auth.me(); } catch { /* sin sesión */ }
    const email = String(user?.email || '').toLowerCase().trim();
    if (!email) return json({ code: 'UNAUTHORIZED' }, 401);

    const db = base44.asServiceRole.entities;
    const body = await req.json().catch(() => ({}));
    const previas = await db.AccountDeletionRequest.filter({ usuario: email });
    const pendiente = (previas || []).find((r: any) => r.estado === 'pendiente' || r.estado === 'en_proceso') || null;

    if (body?.accion === 'estado') return json({ code: 'OK', solicitud: vista(pendiente) });
    if (pendiente) return json({ code: 'ALREADY_REQUESTED', solicitud: vista(pendiente) });

    const v = validarSolicitud(body);
    if (!v.ok) return json({ code: v.code }, 400);

    const miembros = await db.OrganizationMember.filter({ user_email: email, active: true }).catch(() => []);
    const m = (miembros || [])[0] || null;
    const org = m?.organization_id ? (await db.Organization.filter({ id: m.organization_id }).catch(() => []))?.[0] : null;
    const fecha = new Date().toISOString();

    const registro = await db.AccountDeletionRequest.create({
      usuario: email,
      organization_id: m?.organization_id || null,
      organization_name: org?.name || null,
      rol: m?.role || null,
      motivo: v.motivo,
      estado: 'pendiente',
      solicitado_at: fecha,
      email_enviado: false,
    });

    // Aviso a soporte (mejor esfuerzo): la solicitud ya quedó registrada aunque el correo falle.
    let enviado = false;
    try {
      const to = Deno.env.get('SUPPORT_EMAIL') || SUPPORT_EMAIL_DEFAULT;
      const { subject, body: texto } = mensajeSoporte({ usuario: email, organizacion: org?.name, organizationId: m?.organization_id, rol: m?.role, motivo: v.motivo, fecha });
      await base44.asServiceRole.integrations.Core.SendEmail({ to, subject, body: texto });
      enviado = true;
      await db.AccountDeletionRequest.update(registro.id, { email_enviado: true }).catch(() => {});
    } catch (e) {
      console.warn('[requestAccountDeletion]', JSON.stringify({ code: 'SUPPORT_EMAIL_FAILED', reason: e instanceof Error ? e.message.slice(0, 120) : 'unknown' }));
    }

    return json({ code: 'REQUESTED', solicitud: { estado: 'pendiente', solicitado_at: fecha }, email_enviado: enviado });
  } catch (e) {
    console.warn('[requestAccountDeletion]', JSON.stringify({ code: 'ERROR', reason: e instanceof Error ? e.message.slice(0, 120) : 'unknown' }));
    return json({ code: 'REQUEST_FAILED' }, 500);
  }
});
