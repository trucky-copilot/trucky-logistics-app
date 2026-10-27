import { isDemoOrganization, demoRedis, registerDemoOrganization } from "./demoRegistry.ts";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * resolveUserOrganizations
 * ─────────────────────────────────────────────────────────────────────────────
 * Función SERVIDOR-A-SERVIDOR (la invoca el backend de trucky.site, nunca el navegador).
 *
 * Contrato:
 *   POST  Authorization: Bearer <TRUCKY_SERVER_SECRET>
 *   Body: { "google_id_token": "eyJ..." }
 *
 *   200 → { status: "success", user: { email, google_sub }, organizations: [...] }
 *   400 → body inválido | 401 → secreto S2S o token Google inválido | 500 → error interno
 *
 * Variables de entorno requeridas (se configuran en Base44, NUNCA en el chat ni en git):
 *   - TRUCKY_SERVER_SECRET : secreto compartido entre servidores
 *   - GOOGLE_CLIENT_ID     : client ID OAuth de trucky.site (para validar `aud`)
 */

// Roles con permiso para gestionar facturación de la organización
const BILLING_ROLES = new Set(['owner', 'admin']);

// Estados de suscripción que ya otorgan acceso → no se permite otro checkout
const ACTIVE_STATUSES = new Set(['trialing', 'active', 'past_due']);

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

interface GoogleIdentity {
  sub: string;
  email: string;
}

/** Respuesta JSON uniforme. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Comparación en tiempo constante.
 * Por qué: un `===` normal termina en el primer carácter distinto, lo que permite
 * ataques de temporización para adivinar el secreto carácter por carácter.
 */
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

/** Verifica el header Authorization contra TRUCKY_SERVER_SECRET. */
function isAuthorizedServer(req: Request): boolean {
  const expected = Deno.env.get('TRUCKY_SERVER_SECRET');
  // Fail-closed: si el secreto no está configurado, se rechaza TODO.
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return !!match && timingSafeEqual(match[1].trim(), expected);
}

/**
 * Valida el id_token de Google.
 * El endpoint `tokeninfo` de Google verifica firma y expiración; aun así revalidamos
 * localmente `aud`, `iss`, `exp` y `email_verified` (defensa en profundidad).
 * Nota de escalabilidad: tokeninfo añade una llamada de red; si el volumen crece,
 * migrar a verificación local con JWKS (librería `jose`) + caché de claves.
 */
async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity | null> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  if (!clientId) return null; // fail-closed

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  if (!res.ok) return null;

  const claims = await res.json();
  const nowSec = Math.floor(Date.now() / 1000);

  if (claims.aud !== clientId) return null;
  if (!GOOGLE_ISSUERS.has(claims.iss)) return null;
  if (!claims.exp || Number(claims.exp) <= nowSec) return null;
  // tokeninfo devuelve email_verified como string "true"
  if (claims.email_verified !== 'true' && claims.email_verified !== true) return null;
  if (!claims.sub || !claims.email) return null;

  return { sub: String(claims.sub), email: String(claims.email).toLowerCase() };
}

export default async function resolveUserOrganizations(req: Request, _ctx: unknown) {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  // 1) Autenticación entre servidores
  if (!isAuthorizedServer(req)) return json({ error: 'Unauthorized' }, 401);

  // 2) Validación del body
  let body: { google_id_token?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body JSON inválido' }, 400);
  }
  const idToken = body.google_id_token;
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 4096) {
    return json({ error: 'google_id_token requerido' }, 400);
  }

  try {
    // 3) Identidad de Google
    const identity = await verifyGoogleIdToken(idToken);
    // Mensaje genérico a propósito: no revelar qué validación falló
    if (!identity) return json({ error: 'Token de Google inválido o expirado' }, 401);

    // 4) Consulta con rol de servicio (no hay sesión de usuario Base44 en llamadas S2S).
    //    Por eso ESTA función es la responsable de filtrar estrictamente por usuario.
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;

    const memberships = await db.OrganizationMember.filter({
      google_sub: identity.sub,
      active: true,
    });

    const organizations = [];
    for (const m of memberships ?? []) {
      if (!BILLING_ROLES.has(m.role)) continue;

      // Vinculación por `sub` (identificador estable de Google):
      // si la membresía ya tiene google_sub y no coincide, es OTRA cuenta de Google
      // que reutilizó el correo → se excluye. Requiere el campo `google_sub`
      // en OrganizationMember (pendiente de agregar al esquema).
      if (m.google_sub !== identity.sub) continue;

      const orgs = await db.Organization.filter({ id: m.organization_id });
      const org = orgs?.[0];
      if (!org || org.active === false) continue;

      const live = body.mode === 'live';
      const status: string = (live ? org.live_subscription_status : org.subscription_status) ?? 'none';
      organizations.push({
        id: org.id,
        billing_demo_enabled: await isDemoOrganization(org.id),
        name: org.name,
        role: m.role,
        subscription_status: status,
        // Solo informativo: el bloqueo real contra doble checkout se hará con
        // una reserva atómica en la función de checkout (paso posterior).
        can_checkout: !ACTIVE_STATUSES.has(status),
      });
    }

    return json({
      status: 'success',
      user: { email: identity.email, google_sub: identity.sub },
      organizations,
    });
  } catch (error) {
    // Se registra el detalle en logs del servidor, pero no se expone al cliente
    console.error('[resolveUserOrganizations]', error);
    return json({ error: 'Error interno' }, 500);
  }
}
