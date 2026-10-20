import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * createOrganizationForUser
 * ─────────────────────────────────────────────────────────────────────────────
 * Función SERVIDOR-A-SERVIDOR (invocada únicamente por el backend de trucky.site).
 *
 * Contrato:
 *   POST Authorization: Bearer <TRUCKY_SERVER_SECRET>
 *   Body: { 
 *     "google_id_token": "eyJ...",
 *     "company_name": "Nombre de la Empresa",
 *     "account_type": "carrier" | "dispatcher" | "ambos" (opcional, default "carrier")
 *   }
 *
 *   200 / 201 → { 
 *     status: "created" | "already_exists",
 *     org_id: "org_xxx",
 *     name: "Nombre de la Empresa",
 *     role: "owner",
 *     subscription_status: "none"
 *   }
 *   400 → Datos inválidos | 401 → No autorizado | 500 → Error interno
 */

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

interface GoogleIdentity {
  sub: string;
  email: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

function isAuthorizedServer(req: Request): boolean {
  const expected = Deno.env.get('TRUCKY_SERVER_SECRET');
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return !!match && timingSafeEqual(match[1].trim(), expected);
}

async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity | null> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  if (!clientId) return null;

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );
  if (!res.ok) return null;

  const claims = await res.json();
  const nowSec = Math.floor(Date.now() / 1000);

  if (claims.aud !== clientId) return null;
  if (!GOOGLE_ISSUERS.has(claims.iss)) return null;
  if (!claims.exp || Number(claims.exp) <= nowSec) return null;
  if (claims.email_verified !== 'true' && claims.email_verified !== true) return null;
  if (!claims.sub || !claims.email) return null;

  return { sub: String(claims.sub), email: String(claims.email).toLowerCase() };
}

export default async function createOrganizationForUser(req: Request, _ctx: unknown) {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  // 1) Autenticación entre servidores
  if (!isAuthorizedServer(req)) return json({ error: 'Unauthorized' }, 401);

  // 2) Validación del body
  let body: { google_id_token?: unknown; company_name?: unknown; account_type?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body JSON inválido' }, 400);
  }

  const idToken = body.google_id_token;
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 4096) {
    return json({ error: 'google_id_token requerido' }, 400);
  }

  const rawName = body.company_name;
  if (typeof rawName !== 'string' || rawName.trim().length === 0 || rawName.length > 120) {
    return json({ error: 'company_name requerido (máximo 120 caracteres)' }, 400);
  }
  const companyName = rawName.trim();

  const accountType = typeof body.account_type === 'string' && ['carrier', 'dispatcher', 'ambos'].includes(body.account_type)
    ? body.account_type
    : 'carrier';

  try {
    // 3) Identidad de Google
    const identity = await verifyGoogleIdToken(idToken);
    if (!identity) return json({ error: 'Token de Google inválido o expirado' }, 401);

    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;

    // 4) Idempotencia y verificación previa:
    // Comprobar si el usuario ya tiene una organización creada con ese nombre
    const existingMemberships = await db.OrganizationMember.filter({
      user_email: identity.email,
      active: true,
      role: 'owner'
    });

    for (const m of existingMemberships ?? []) {
      const orgs = await db.Organization.filter({ id: m.organization_id });
      const org = orgs?.[0];
      if (org && org.active !== false && org.name.toLowerCase() === companyName.toLowerCase()) {
        // Aseguramos que google_sub quede guardado si no estaba
        if (!m.google_sub) {
          await db.OrganizationMember.update(m.id, { google_sub: identity.sub });
        }
        return json({
          status: 'already_exists',
          org_id: org.id,
          name: org.name,
          role: 'owner',
          subscription_status: org.subscription_status ?? 'none'
        }, 200);
      }
    }

    // 5) Crear la Organización
    const newOrg = await db.Organization.create({
      name: companyName,
      account_type: accountType,
      workspace_status: 'setup',
      onboarding_completed: false,
      production_ready: false,
      active: true,
      created_by_user: identity.email,
      subscription_status: 'none',
      checkout_in_progress: false
    });

    // 6) Crear la membresía atómica como 'owner'
    await db.OrganizationMember.create({
      organization_id: newOrg.id,
      user_email: identity.email,
      google_sub: identity.sub,
      role: 'owner',
      active: true
    });

    return json({
      status: 'created',
      org_id: newOrg.id,
      name: newOrg.name,
      role: 'owner',
      subscription_status: 'none'
    }, 201);

  } catch (error) {
    console.error('[createOrganizationForUser]', error);
    return json({ error: 'Error interno al crear la organización' }, 500);
  }
}
