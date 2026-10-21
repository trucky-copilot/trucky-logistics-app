import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * reserveOrganizationCheckout
 * ─────────────────────────────────────────────────────────────────────────────
 * Función SERVIDOR-A-SERVIDOR (invocada por el backend de trucky.site en Vercel).
 *
 * Arquitectura de Exclusión Mutua Atómica:
 *   Utiliza la entidad transaccional `CheckoutLock`.
 *   - Al intentar crear una reserva, primero se busca cualquier lock activo.
 *   - Si existe uno activo, se evalúa idempotencia.
 *   - Si no existe lock o ya venció, se crea un nuevo registro `CheckoutLock`.
 *   - Si dos peticiones simultáneas crean un lock (colisión concurrente), ambas
 *     consultan de inmediato todos los locks activos ordenados por timestamp.
 *     Únicamente el lock con el timestamp más antiguo (first-write-wins determinista)
 *     se declara ganador; el perdedor elimina su lock espurio y retorna 409 Conflict.
 *
 * Integración con Stripe:
 *   - Al liberar o evaluar vencimiento, consulta el estado real en Stripe API.
 *   - Si la sesión está 'open', la expira activamente (`sessions.expire()`).
 *   - Si está 'complete', bloquea contrataciones y actualiza la organización a 'active'.
 *   - No se permite liberar reservas con sesiones de pago abiertas utilizables.
 */

const BILLING_ROLES = new Set(['owner', 'admin']);
const ACTIVE_STATUSES = new Set(['trialing', 'active', 'past_due']);
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

// TTL de la reserva: 15 minutos (900,000 ms)
const RESERVATION_TTL_MS = 15 * 60 * 1000;

interface GoogleIdentity {
  sub: string;
  email: string;
}

interface StripeSessionStatus {
  status: 'open' | 'complete' | 'expired' | 'unknown';
  subscriptionId?: string;
  customerId?: string;
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

/**
 * Consulta el estado real de la sesión en Stripe API
 */
async function checkStripeSession(sessionId: string): Promise<StripeSessionStatus> {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey || !sessionId || !sessionId.startsWith('cs_')) {
    return { status: 'unknown' };
  }

  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: {
        Authorization: `Bearer ${stripeKey}`,
      },
    });

    if (!res.ok) {
      return { status: 'unknown' };
    }

    const data = await res.json();
    return {
      status: data.status, // 'open' | 'complete' | 'expired'
      subscriptionId: data.subscription,
      customerId: data.customer,
    };
  } catch {
    return { status: 'unknown' };
  }
}

/**
 * Expira forzosamente una sesión abierta en Stripe para que no pueda ser pagada
 */
async function expireStripeSession(sessionId: string): Promise<boolean> {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey || !sessionId || !sessionId.startsWith('cs_')) {
    return false;
  }

  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/expire`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
      },
    });

    return res.ok;
  } catch {
    return false;
  }
}

export default async function reserveOrganizationCheckout(req: Request, _ctx: unknown) {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  // 1) Autenticación S2S
  if (!isAuthorizedServer(req)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // 2) Parseo de Body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body JSON inválido' }, 400);
  }

  const { google_id_token, organization_id } = body;
  if (typeof google_id_token !== 'string' || google_id_token.length < 20) {
    return json({ error: 'google_id_token es requerido' }, 400);
  }
  if (typeof organization_id !== 'string' || !organization_id.trim()) {
    return json({ error: 'organization_id es requerido' }, 400);
  }

  const action = typeof body.action === 'string' ? body.action : 'reserve';
  const orgId = organization_id.trim();

  try {
    // 3) Verificación de identidad con Google
    const identity = await verifyGoogleIdToken(google_id_token);
    if (!identity) {
      return json({ error: 'Token de Google inválido o expirado' }, 401);
    }

    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;

    // 4) Autorización estricta vinculada por google_sub (Punto 7 de Vercel)
    // Primero buscar por google_sub
    let memberships = await db.OrganizationMember.filter({
      organization_id: orgId,
      google_sub: identity.sub,
      active: true,
    });

    // Migración segura: si no tiene google_sub aún, buscar por user_email verificado y vincular
    if (!memberships || memberships.length === 0) {
      const emailMemberships = await db.OrganizationMember.filter({
        organization_id: orgId,
        user_email: identity.email,
        active: true,
      });

      const cand = emailMemberships?.[0];
      if (cand && !cand.google_sub) {
        // Enlazar de forma permanente e inmutable el google_sub verificado
        await db.OrganizationMember.update(cand.id, {
          google_sub: identity.sub,
        });
        cand.google_sub = identity.sub;
        memberships = [cand];
      }
    }

    const membership = memberships?.[0];
    if (!membership || !BILLING_ROLES.has(membership.role)) {
      return json({ error: 'El usuario no tiene permisos de facturación (owner/admin) sobre esta organización' }, 403);
    }

    if (membership.google_sub !== identity.sub) {
      return json({ error: 'Discrepancia de identidad Google (sub no coincide con el miembro registrado)' }, 403);
    }

    // 5) Consultar estado actual de la Organización
    const orgs = await db.Organization.filter({ id: orgId });
    const org = orgs?.[0];
    if (!org || org.active === false) {
      return json({ error: 'Organización no encontrada o inactiva' }, 404);
    }

    // 6) Rechazar si ya existe suscripción activa
    const subStatus = org.subscription_status ?? 'none';
    if (ACTIVE_STATUSES.has(subStatus)) {
      return json({
        error: `La organización ya cuenta con una suscripción activa (${subStatus})`,
        code: 'ALREADY_SUBSCRIBED',
        subscription_status: subStatus,
      }, 409);
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    // ─────────────────────────────────────────────────────────────────────────
    // ACCIÓN: RELEASE (Liberar reserva comprobando estado en Stripe)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'release') {
      const targetResId = body.reservation_id;
      if (!targetResId) {
        return json({ error: 'reservation_id es requerido para liberar' }, 400);
      }

      // Buscar el lock
      const activeLocks = await db.CheckoutLock.filter({
        organization_id: orgId,
        reservation_id: targetResId,
      });

      const lock = activeLocks?.[0];
      if (!lock) {
        return json({ status: 'already_released', organization_id: orgId });
      }

      // Si tiene una sesión de Stripe asignada, verificarla antes de liberar (Puntos 2, 3 y 4 de Vercel)
      if (lock.stripe_session_id) {
        const stripeStatus = await checkStripeSession(lock.stripe_session_id);

        if (stripeStatus.status === 'complete') {
          // Si está completada, conciliar y no liberar como abandonada (Punto 4 de Vercel)
          await db.Organization.update(org.id, {
            subscription_status: 'active',
            stripe_subscription_id: stripeStatus.subscriptionId || org.stripe_subscription_id,
            stripe_customer_id: stripeStatus.customerId || org.stripe_customer_id,
            checkout_in_progress: false,
          });
          await db.CheckoutLock.update(lock.id, { status: 'completed' });

          return json({
            error: 'La sesión de pago ya fue completada exitosamente en Stripe. Se ha activado la suscripción.',
            code: 'ALREADY_COMPLETED',
            subscription_status: 'active',
          }, 409);
        }

        if (stripeStatus.status === 'open') {
          // Expirar la sesión en Stripe activamente para que el enlace deje de funcionar
          const expired = await expireStripeSession(lock.stripe_session_id);
          if (!expired) {
            return json({
              error: 'No se pudo expirar la sesión abierta en Stripe. La reserva no puede ser liberada mientras el checkout esté utilizable.',
              code: 'STRIPE_SESSION_STILL_OPEN',
            }, 409);
          }
        }
      }

      // Eliminar el lock de Base44
      await db.CheckoutLock.delete(lock.id);
      await db.Organization.update(org.id, {
        checkout_in_progress: false,
        checkout_locked_at: null,
        checkout_reservation_id: null,
      });

      return json({
        status: 'released',
        organization_id: org.id,
        reservation_id: targetResId,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCIÓN: ATTACH_STRIPE_SESSION (Asociar sesión de Stripe creada)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'attach_stripe_session') {
      const targetResId = body.reservation_id;
      const stripeSessionId = body.stripe_session_id;

      if (!targetResId || !stripeSessionId || !stripeSessionId.startsWith('cs_')) {
        return json({ error: 'reservation_id y stripe_session_id válidos son requeridos' }, 400);
      }

      const activeLocks = await db.CheckoutLock.filter({
        organization_id: orgId,
        reservation_id: targetResId,
      });

      const lock = activeLocks?.[0];
      if (!lock) {
        return json({ error: 'La reserva especificada no existe o expiró' }, 409);
      }

      await db.CheckoutLock.update(lock.id, {
        stripe_session_id: stripeSessionId,
        status: 'attached',
      });

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
    // ACCIÓN: RESERVE (Exclusión Mutua Atómica + Idempotencia Robusta)
    // ─────────────────────────────────────────────────────────────────────────
    const incomingIdempotency = typeof body.idempotency_key === 'string' && body.idempotency_key.trim()
      ? body.idempotency_key.trim()
      : `idem_${crypto.randomUUID()}`;

    // Consultar todos los locks de esta organización
    const existingLocks = await db.CheckoutLock.filter({ organization_id: orgId });

    // Filtrar locks activos no completados/liberados
    for (const lk of existingLocks || []) {
      const lkExpires = new Date(lk.expires_at).getTime();

      // Caso 1: Idempotencia estricta (Punto 6 de Vercel)
      if (lk.idempotency_key === incomingIdempotency) {
        return json({
          status: 'already_reserved',
          organization_id: org.id,
          reservation_id: lk.reservation_id,
          idempotency_key: lk.idempotency_key,
          stripe_session_id: lk.stripe_session_id || null,
          expires_at: lk.expires_at,
        }, 200);
      }

      // Si el lock aún está dentro de los 15 minutos de TTL:
      if (now < lkExpires) {
        // Si tiene sesión de Stripe, verificar su estado real antes de rechazar o permitir
        if (lk.stripe_session_id) {
          const stStatus = await checkStripeSession(lk.stripe_session_id);
          if (stStatus.status === 'complete') {
            await db.Organization.update(org.id, {
              subscription_status: 'active',
              stripe_subscription_id: stStatus.subscriptionId,
              stripe_customer_id: stStatus.customerId,
              checkout_in_progress: false,
            });
            await db.CheckoutLock.update(lk.id, { status: 'completed' });
            return json({
              error: 'La suscripción ya se encuentra completada y activa.',
              code: 'ALREADY_SUBSCRIBED',
              subscription_status: 'active',
            }, 409);
          }
        }

        const remainingSec = Math.ceil((lkExpires - now) / 1000);
        return json({
          error: `Hay un proceso de pago en curso para esta organización. Intenta nuevamente en ${remainingSec} segundos.`,
          code: 'CHECKOUT_LOCKED',
          organization_id: org.id,
          remaining_seconds: remainingSec,
          reservation_id: lk.reservation_id,
          stripe_session_id: lk.stripe_session_id || null,
        }, 409);
      }

      // Si el TTL expiró pero tiene sesión de Stripe, verificar Stripe antes de sobreescribir (Punto 3 de Vercel)
      if (lk.stripe_session_id) {
        const stStatus = await checkStripeSession(lk.stripe_session_id);
        if (stStatus.status === 'open') {
          // Aún abierta en Stripe: expirarla forzosamente para no dejar checkout huérfano
          await expireStripeSession(lk.stripe_session_id);
        } else if (stStatus.status === 'complete') {
          await db.Organization.update(org.id, {
            subscription_status: 'active',
            stripe_subscription_id: stStatus.subscriptionId,
            stripe_customer_id: stStatus.customerId,
          });
          return json({
            error: 'La suscripción ya fue completada.',
            code: 'ALREADY_SUBSCRIBED',
            subscription_status: 'active',
          }, 409);
        }
      }

      // Limpiar lock vencido y verificado
      try {
        await db.CheckoutLock.delete(lk.id);
      } catch (_) {}
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Adquisición del Lock con Resolución de Colisión Determinista (Punto 1 de Vercel)
    // ─────────────────────────────────────────────────────────────────────────
    const myReservationId = `res_${Date.now()}_${crypto.randomUUID()}`;
    const myExpiresAt = new Date(now + RESERVATION_TTL_MS).toISOString();

    const createdLock = await db.CheckoutLock.create({
      organization_id: orgId,
      reservation_id: myReservationId,
      idempotency_key: incomingIdempotency,
      created_at: nowIso,
      expires_at: myExpiresAt,
      status: 'reserved',
    });

    // Pequeño retardo de ordenación (50ms) y verificación de colisión
    await new Promise((resolve) => setTimeout(resolve, 50));

    const checkAll = await db.CheckoutLock.filter({ organization_id: orgId });
    // Ordenar de forma determinista por created_at ascendente
    const sorted = (checkAll || []).sort((a: any, b: any) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    // El primer registro en la línea de tiempo es el ganador inequívoco
    const winner = sorted[0];

    if (!winner || winner.reservation_id !== myReservationId) {
      // Perdimos la carrera: eliminar el lock perdedor para no dejar basura
      try {
        await db.CheckoutLock.delete(createdLock.id);
      } catch (_) {}

      return json({
        error: 'Conflicto de concurrencia: otra solicitud reservó simultáneamente el checkout',
        code: 'CHECKOUT_LOCKED',
        organization_id: orgId,
      }, 409);
    }

    // Si ganamos la carrera, actualizar Organization
    await db.Organization.update(org.id, {
      checkout_in_progress: true,
      checkout_locked_at: nowIso,
      checkout_reservation_id: myReservationId,
      checkout_idempotency_key: incomingIdempotency,
      stripe_checkout_session_id: null,
    });

    return json({
      status: 'reserved',
      organization_id: org.id,
      reservation_id: myReservationId,
      idempotency_key: incomingIdempotency,
      expires_at: myExpiresAt,
    }, 201);

  } catch (err: any) {
    console.error('[reserveOrganizationCheckout Exception]:', err);
    return json({ error: err?.message || 'Error interno al procesar reserva de checkout' }, 500);
  }
}
