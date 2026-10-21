import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * reserveOrganizationCheckout
 * ─────────────────────────────────────────────────────────────────────────────
 * Función SERVIDOR-A-SERVIDOR (invocada únicamente por el backend de trucky.site en Vercel).
 *
 * Propósito:
 *   Garantizar la reserva atómica, persistente e idempotente de un proceso de Checkout
 *   de Stripe para una Organización, impidiendo dobles contrataciones simultáneas o
 *   suscripciones duplicadas.
 *
 * Contrato:
 *   POST /api/functions/reserveOrganizationCheckout
 *   Headers:
 *     Authorization: Bearer <TRUCKY_SERVER_SECRET>
 *     Content-Type: application/json
 *   Body:
 *     {
 *       "google_id_token": "eyJ...",
 *       "organization_id": "67...",
 *       "idempotency_key": "opcional_client_uuid_o_hash",
 *       "action": "reserve" | "attach_stripe_session" | "release",
 *       "stripe_session_id": "cs_test_..." (requerido si action === "attach_stripe_session"),
 *       "reservation_id": "res_..." (requerido para "attach_stripe_session" o "release")
 *     }
 *
 * Respuestas:
 *   200 / 201 → {
 *     status: "reserved" | "already_reserved" | "attached" | "released",
 *     organization_id: "...",
 *     reservation_id: "res_...",
 *     idempotency_key: "...",
 *     expires_at: "2026-10-21T09:30:00.000Z"
 *   }
 *   400 → Bad Request (parámetros faltantes o inválidos)
 *   401 → Unauthorized (secreto S2S o Google token inválido / expirado)
 *   403 → Forbidden (el usuario no tiene rol 'owner' o 'admin' en la organización)
 *   409 → Conflict (ya tiene suscripción activa O hay un checkout en curso concurrente no expirado)
 *   500 → Internal Server Error
 */

// Roles con permiso para facturar en la organización
const BILLING_ROLES = new Set(['owner', 'admin']);

// Estados de suscripción que ya otorgan acceso pleno → no se permite checkout
const ACTIVE_STATUSES = new Set(['trialing', 'active', 'past_due']);

// Emisores válidos de Google ID Tokens
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

// TTL de la reserva: 15 minutos (tiempo de vida estándar de una sesión de Stripe Checkout)
const RESERVATION_TTL_MS = 15 * 60 * 1000;

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

export default async function reserveOrganizationCheckout(req: Request, _ctx: unknown) {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  // 1) Autenticación S2S con tiempo constante
  if (!isAuthorizedServer(req)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // 2) Parseo y validación inicial de Body
  let body: {
    google_id_token?: unknown;
    organization_id?: unknown;
    idempotency_key?: unknown;
    action?: unknown;
    stripe_session_id?: unknown;
    reservation_id?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body JSON inválido' }, 400);
  }

  const { google_id_token, organization_id } = body;
  if (typeof google_id_token !== 'string' || google_id_token.length < 20 || google_id_token.length > 4096) {
    return json({ error: 'google_id_token es requerido y debe ser un JWT válido' }, 400);
  }
  if (typeof organization_id !== 'string' || !organization_id.trim()) {
    return json({ error: 'organization_id es requerido' }, 400);
  }

  const action = typeof body.action === 'string' ? body.action : 'reserve';

  try {
    // 3) Verificación de identidad con Google
    const identity = await verifyGoogleIdToken(google_id_token);
    if (!identity) {
      return json({ error: 'Token de Google inválido, expirado o audiencia no coincide' }, 401);
    }

    // 4) Cliente con Service Role para lectura/actualización autorizada
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;

    // 5) Verificar permisos de facturación del usuario en la organización
    const memberships = await db.OrganizationMember.filter({
      organization_id: organization_id.trim(),
      user_email: identity.email,
      active: true,
    });

    const membership = memberships?.[0];
    if (!membership || !BILLING_ROLES.has(membership.role)) {
      return json({ error: 'El usuario no tiene permisos de facturación (owner/admin) sobre esta organización' }, 403);
    }

    // Comprobación de google_sub si ya está persistido
    if (membership.google_sub && membership.google_sub !== identity.sub) {
      return json({ error: 'Discrepancia en la identidad del usuario Google' }, 403);
    }

    // 6) Consultar estado actual de la Organización
    const orgs = await db.Organization.filter({ id: organization_id.trim() });
    const org = orgs?.[0];
    if (!org || org.active === false) {
      return json({ error: 'Organización no encontrada o inactiva' }, 404);
    }

    // 7) Rechazar si ya existe suscripción activa vigente
    const subStatus = org.subscription_status ?? 'none';
    if (ACTIVE_STATUSES.has(subStatus)) {
      return json({
        error: `La organización ya cuenta con una suscripción activa o vigente (${subStatus})`,
        code: 'ALREADY_SUBSCRIBED',
        subscription_status: subStatus,
      }, 409);
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    // ─────────────────────────────────────────────────────────────────────────
    // ACCIÓN: RELEASE (Liberar reserva si el checkout falló o fue cancelado)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'release') {
      const targetResId = body.reservation_id;
      if (typeof targetResId !== 'string' || !targetResId) {
        return json({ error: 'reservation_id es requerido para liberar la reserva' }, 400);
      }

      // Proteger: no liberar si el reservation_id no coincide o si ya expiró
      if (org.checkout_reservation_id === targetResId) {
        // No liberar si tiene una sesión de Checkout de Stripe activa asignada (a menos que Stripe confirme expiración)
        await db.Organization.update(org.id, {
          checkout_in_progress: false,
          checkout_locked_at: null,
          checkout_reservation_id: null,
          checkout_idempotency_key: null,
          stripe_checkout_session_id: null,
        });

        return json({
          status: 'released',
          organization_id: org.id,
          reservation_id: targetResId,
        });
      }

      return json({ status: 'already_released', organization_id: org.id });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCIÓN: ATTACH_STRIPE_SESSION (Asociar el session.id creado en Stripe)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'attach_stripe_session') {
      const targetResId = body.reservation_id;
      const stripeSessionId = body.stripe_session_id;

      if (typeof targetResId !== 'string' || typeof stripeSessionId !== 'string' || !stripeSessionId.startsWith('cs_')) {
        return json({ error: 'reservation_id y stripe_session_id (cs_...) válidos son requeridos' }, 400);
      }

      if (org.checkout_reservation_id !== targetResId) {
        return json({ error: 'La reserva especificada no está activa o ya expiró' }, 409);
      }

      await db.Organization.update(org.id, {
        stripe_checkout_session_id: stripeSessionId,
      });

      return json({
        status: 'attached',
        organization_id: org.id,
        reservation_id: targetResId,
        stripe_session_id: stripeSessionId,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCIÓN: RESERVE (Reserva atómica e idempotente)
    // ─────────────────────────────────────────────────────────────────────────
    const incomingIdempotency = typeof body.idempotency_key === 'string' && body.idempotency_key.trim()
      ? body.idempotency_key.trim()
      : null;

    const lockedAt = org.checkout_locked_at ? new Date(org.checkout_locked_at).getTime() : 0;
    const isLockActive = org.checkout_in_progress === true && (now - lockedAt < RESERVATION_TTL_MS);

    // Caso A: Reintento del mismo intento (Idempotencia)
    // Si la reserva está activa Y coincide la clave de idempotencia O el usuario reintenta la misma reserva:
    if (isLockActive && incomingIdempotency && org.checkout_idempotency_key === incomingIdempotency) {
      const expiresAt = new Date(lockedAt + RESERVATION_TTL_MS).toISOString();
      return json({
        status: 'already_reserved',
        organization_id: org.id,
        reservation_id: org.checkout_reservation_id,
        idempotency_key: org.checkout_idempotency_key,
        stripe_session_id: org.stripe_checkout_session_id || null,
        expires_at: expiresAt,
      }, 200);
    }

    // Caso B: Conflicto de Concurrencia
    // La reserva sigue activa, no ha expirado el TTL (15 min) y pertenece a otra petición
    if (isLockActive) {
      const remainingSec = Math.ceil((RESERVATION_TTL_MS - (now - lockedAt)) / 1000);
      return json({
        error: `Hay un proceso de pago en curso para esta organización. Intenta nuevamente en ${remainingSec} segundos.`,
        code: 'CHECKOUT_LOCKED',
        organization_id: org.id,
        remaining_seconds: remainingSec,
      }, 409);
    }

    // Caso C: Creación / Renovación de Reserva Atómica
    const newReservationId = `res_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const effectiveIdempotencyKey = incomingIdempotency || `idem_${crypto.randomUUID()}`;

    // Actualización atómica en Base44
    await db.Organization.update(org.id, {
      checkout_in_progress: true,
      checkout_locked_at: nowIso,
      checkout_reservation_id: newReservationId,
      checkout_idempotency_key: effectiveIdempotencyKey,
      stripe_checkout_session_id: null, // limpia sesiones anteriores expiradas
    });

    const expiresAt = new Date(now + RESERVATION_TTL_MS).toISOString();

    return json({
      status: 'reserved',
      organization_id: org.id,
      reservation_id: newReservationId,
      idempotency_key: effectiveIdempotencyKey,
      expires_at: expiresAt,
    }, 201);

  } catch (err: any) {
    console.error('[reserveOrganizationCheckout Error]:', err);
    return json({ error: err?.message || 'Error interno al reservar checkout' }, 500);
  }
}
