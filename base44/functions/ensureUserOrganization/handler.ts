import {readEnrollment} from './enrollment.ts';
import {demoRedis} from './demoRegistry.ts';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * ensureUserOrganization
 * ─────────────────────────────────────────────────────────────────────────────
 * Crea (o devuelve) la organización del usuario autenticado y su membresía
 * como 'owner'. La invoca el Onboarding de la app.
 *
 * Por qué existe: Organization y OrganizationMember ya no se pueden crear
 * desde el cliente (las reglas de acceso solo lo permiten a admin), para que
 * nadie pueda:
 *   - crearse una organización con subscription_status/plan_type de pago, ni
 *   - crearse una membresía en una organización ajena.
 * Esta función escribe con rol de servicio y SOLO acepta campos permitidos:
 * los de facturación siempre nacen en su valor por defecto.
 *
 * Body (opcional): { company_name?: string (≤120), account_type?: 'carrier'|'dispatcher'|'ambos' }
 * Respuesta: { status: 'created'|'existing', org_id, name }
 */

const ALLOWED_ORIGIN_SUFFIXES = ['.base44.app', '.base44.com'];
const ALLOWED_ORIGIN_PREFIXES = ['http://localhost:', 'http://127.0.0.1:'];
const ACCOUNT_TYPES = new Set(['carrier', 'dispatcher', 'ambos']);
const MAX_NAME = 120;

function corsHeadersFor(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowed =
    !!origin &&
    (ALLOWED_ORIGIN_SUFFIXES.some((s) => origin.endsWith(s)) ||
      ALLOWED_ORIGIN_PREFIXES.some((p) => origin.startsWith(p)));
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

// Texto plano: sin etiquetas ni caracteres de control, espacios colapsados.
export function cleanCompanyName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
}

export function cleanAccountType(value: unknown): string {
  return typeof value === 'string' && ACCOUNT_TYPES.has(value) ? value : 'carrier';
}

export async function ensureUserOrganization(req:Request,deps?:{user:any;db:any;redis:(c:unknown[])=>Promise<any>}) {
  const readRedis=deps?.redis??demoRedis;
  const cors = corsHeadersFor(req);
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: cors });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const base44 = deps?null:createClientFromRequest(req);
    const user = deps?.user??await base44!.auth.me().catch(() => null);
    if (!user?.email) return json({ error: 'No autenticado' }, 401);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch (_) { /* body opcional */ }

    const db = deps?.db??base44!.asServiceRole.entities;
    const email: string = user.email;

    // 1) Organización existente del usuario (idempotente: nunca crea una segunda).
    const owned = await db.Organization.filter({ created_by_user: email });
    let org = (owned ?? []).find((o: any) => o.active !== false) ?? null;
    let status = 'existing';

    if (!org) {
      const name = cleanCompanyName(body.company_name) || cleanCompanyName(user.full_name) || email;
      // Solo campos permitidos. Los de facturación quedan en su default del esquema.
      org = await db.Organization.create({
        name,
        account_type: cleanAccountType(body.account_type),
        created_by_user: email,
        workspace_status: 'production',
        onboarding_completed: true,
        production_ready: true,
        active: true,
      });
      status = 'created';
    }

    if(!org)return json({error:'ORGANIZATION_REQUIRES_REVIEW'},503);
    // Preserve native legacy onboarding. A server-enrolled web company requires
    // its existing linked member, never a newly minted owner by matching email.
    const members = await db.OrganizationMember.filter({ organization_id: org.id, user_email: email });
    if(members?.some((m:any)=>!!m.google_sub)){
      const enrolled=await readEnrollment(readRedis,org.id,true);
      if(enrolled){
        const exact=members.filter((m:any)=>m.id===enrolled.memberId&&m.google_sub===enrolled.googleSub&&m.active===true);
        if(exact.length!==1||exact[0].base44_user_id!==user.id)return json({error:'BILLING_IDENTITY_LINK_REQUIRED'},409);
      }
    }

    if (!members || members.length === 0) {
      await db.OrganizationMember.create({
        organization_id: org.id,
        user_email: email,
        role: 'owner',
        active: true,
      });
    }

    return json({ status, org_id: org.id, name: org.name });
  } catch (err) {
    console.error('[ensureUserOrganization]', err);
    return json({ error: 'No se pudo preparar la organización' }, 500);
  }
}
