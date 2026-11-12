// F3-15 · Fase 4 — "Mi plan": devuelve método de pago, historial de cobros y
// estado de la suscripción de la organización del usuario, y permite
// cancelar (al final del período, reversible) o reanudar.
// Seguridad: el usuario debe ser miembro activo de la organización; cancelar
// y reanudar solo owner/admin y con confirmar=true. Nunca mezcla pruebas y
// real (ver shared/billingDetails.ts). Las llaves nunca salen del servidor.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { logAndSanitizeError } from '../../shared/safeError.ts';
import { cancelChange, cardView, chooseBillingMode, invoicesView, subscriptionBelongs, subscriptionView } from '../../shared/billingDetails.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const EDIT_ROLES = ['owner', 'admin'];

async function stripe(key: string, path: string, init: { method?: string; form?: Record<string, string>; query?: [string, string][] } = {}) {
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  for (const [k, v] of init.query || []) url.searchParams.append(k, v);
  const r = await fetch(url, {
    method: init.method || 'GET', redirect: 'manual', signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Bearer ${key}`, ...(init.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: init.form ? new URLSearchParams(init.form) : undefined,
  }).catch(() => { throw Error('STRIPE_UNAVAILABLE'); });
  if (!r.ok || r.status >= 300) throw Error(r.status === 403 ? 'STRIPE_PERMISSION' : 'STRIPE_UNAVAILABLE');
  return await r.json();
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const base44 = createClientFromRequest(req);
    let user: any = null;
    try { user = await base44.auth.me(); } catch { /* sin sesión */ }
    const email = String(user?.email || '').toLowerCase();
    if (!email) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const orgId = typeof body?.organization_id === 'string' ? body.organization_id : '';
    const accion = String(body?.accion || 'detalle');
    if (!orgId) return json({ error: 'Falta organization_id' }, 400);

    const db = base44.asServiceRole.entities;
    const members = await db.OrganizationMember.filter({ organization_id: orgId, active: true });
    const member = (members || []).find((m: any) => String(m.user_email || '').toLowerCase() === email);
    if (!member) return json({ error: 'Forbidden' }, 403);
    const org = (await db.Organization.filter({ id: orgId }))?.[0];
    if (!org) return json({ error: 'La empresa no existe', code: 'ORG_NOT_FOUND' }, 404);
    const puede_cancelar = EDIT_ROLES.includes(member.role);

    const m = chooseBillingMode(org, { live: Deno.env.get('STRIPE_LIVE_SECRET_KEY'), test: Deno.env.get('STRIPE_SECRET_KEY') });
    if (m.mode === 'none') return json({ ok: true, modo: 'none', motivo: m.reason, puede_cancelar });

    const sub = await stripe(m.key, `subscriptions/${m.subscriptionId}`, { query: [['expand[]', 'default_payment_method']] });
    if (!subscriptionBelongs(sub, org, m)) return json({ error: 'La suscripción no corresponde a esta empresa', code: 'SUBSCRIPTION_MISMATCH' }, 409);

    if (accion === 'cancelar' || accion === 'reanudar') {
      if (!puede_cancelar) return json({ error: 'Solo el dueño o un administrador de la empresa puede hacer este cambio' }, 403);
      if (body?.confirmar !== true) return json({ error: 'Falta confirmar', requiere_confirmacion: true }, 409);
      const c = cancelChange(accion, sub);
      if (!c.ok) return json({ error: c.error }, c.status);
      const after = await stripe(m.key, `subscriptions/${m.subscriptionId}`, { method: 'POST', form: { cancel_at_period_end: String(c.cancel_at_period_end) } });
      return json({ ok: true, modo: m.mode, suscripcion: subscriptionView(after), puede_cancelar });
    }
    if (accion !== 'detalle') return json({ error: 'Acción no válida' }, 400);

    let pm = sub.default_payment_method;
    if (!pm || typeof pm !== 'object') {
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
      if (customerId) {
        const cus = await stripe(m.key, `customers/${customerId}`, { query: [['expand[]', 'invoice_settings.default_payment_method']] }).catch(() => null);
        pm = cus?.invoice_settings?.default_payment_method || null;
      }
    }
    const inv = await stripe(m.key, 'invoices', { query: [['subscription', m.subscriptionId], ['limit', '24']] }).catch(() => ({ data: [] }));
    return json({ ok: true, modo: m.mode, suscripcion: subscriptionView(sub), metodo_pago: cardView(pm), cobros: invoicesView(inv.data || []), puede_cancelar });
  } catch (error) {
    const msg = (error as Error)?.message;
    if (msg === 'STRIPE_PERMISSION') return json({ error: 'La llave de Stripe no tiene permiso para esta operación', code: 'STRIPE_PERMISSION' }, 503);
    if (msg === 'STRIPE_UNAVAILABLE') return json({ error: 'No se pudo consultar Stripe. Intenta de nuevo.', code: 'STRIPE_UNAVAILABLE' }, 503);
    return json(logAndSanitizeError('manageMyBilling', error), 500);
  }
});
