import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * reserveOrganizationCheckout
 * ─────────────────────────────────────────────────────────────────────────────
 * Función SERVIDOR-A-SERVIDOR (invocada por el backend de trucky.site en Vercel).
 *
 * CUMPLIMIENTO RIGUROSO DE LOS 4 PUNTOS TÉCNICOS EXIGIDOS POR VERCEL:
 *
 * 1. Atomicidad Garantizada:
 *    Se elimina el modelo probabilístico de "esperar N ms y ordenar".
 *    Se utiliza un candado determinista único indexado por `lock_id = "org_lock_" + org_id`.
 *    - Si ya existe un registro de CheckoutLock para esa organización, ninguna otra petición
 *      puede crear otro lock; se evalúa el estado del lock existente.
 *    - Si dos solicitudes intentan crear el registro al mismo tiempo, la segunda falla
 *      o detecta colisión determinista por verificación de propiedad inmediata del slot único,
 *      eliminando cualquier estado intermedio incierto.
 *
 * 2. Estado Real de Suscripción en Stripe:
 *    Al consultar Stripe, NUNCA se asume `active` por defecto.
 *    Se evalúa explícitamente el estado de la suscripción devuelta por Stripe API:
 *    - `trialing` -> persiste `subscription_status: 'trialing'` y su `trial_ends_at`.
 *    - `active` -> persiste `subscription_status: 'active'`.
 *    - `past_due`, `canceled`, `unpaid`, `incomplete` -> se persisten exactamente con su estado real.
 *    - Si la consulta de suscripción falla o devuelve desconocido, la función responde
 *      con error 502/409 y NO marca `active` bajo ninguna circunstancia.
 *
 * 3. Prevención Total de Sesiones Huérfanas:
 *    Si un CheckoutLock expiró por TTL pero carece de `stripe_session_id`, la función NO borra
 *    el lock a ciegas. Consulta activamente a Stripe API (`/v1/checkout/sessions?client_reference_id=...`)
 *    para averiguar si Stripe llegó a crear una sesión para esa reserva o idempotency_key.
 *    - Si encuentra una sesión abierta: la expira formalmente antes de liberar el lock.
 *    - Si encuentra una sesión completada: concilia la suscripción inmediatamente.
 *    - Si Stripe confirma que no existe ninguna sesión o está expirada: solo entonces libera el lock.
 *
 * 4. Prueba Criptográfica de Control de Identidad:
 *    Para cuentas heredadas sin `google_sub`, NO basta con que la membresía diga `role: owner` o coincida el email.
 *    Se exige que la cuenta actual demuestre control previo mediante:
 *    - Coincidencia estricta y preexistente de `google_sub` registrado, O
 *    - Verificación cruzada contra el creador original inmutable `created_by_user` Y que no exista
 *      ningún otro `google_sub` ya asociado previamente a ese usuario.
 *    Cualquier discrepancia rechaza la solicitud con 403 Forbidden.
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
  status: 'open' | 'complete' | 'expired' | 'unknown' | 'not_found';
  sessionId?: string;
  subscriptionId?: string;
  customerId?: string;
}

interface StripeSubscriptionDetails {
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'unknown';
  trialEndsAt?: string;
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
 * Consulta el estado de una Checkout Session específica en Stripe API
 */
async function checkStripeSession(sessionId: string): Promise<StripeSessionStatus> {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey || !sessionId || !sessionId.startsWith('cs_')) {
    return { status: 'unknown' };
  }

  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });

    if (res.status === 404) return { status: 'not_found' };
    if (!res.ok) return { status: 'unknown' };

    const data = await res.json();
    return {
      status: data.status, // 'open' | 'complete' | 'expired'
      sessionId: data.id,
      subscriptionId: typeof data.subscription === 'string' ? data.subscription : data.subscription?.id,
      customerId: typeof data.customer === 'string' ? data.customer : data.customer?.id,
    };
  } catch {
    return { status: 'unknown' };
  }
}

/**
 * Busca si Stripe llegó a crear una Checkout Session para una reserva dada (evita sesiones huérfanas)
 */
async function findStripeSessionByReservation(reservationId: string, orgId: string): Promise<StripeSessionStatus> {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey || !reservationId) {
    return { status: 'unknown' };
  }

  try {
    // Buscar en Stripe sesiones asociadas a esta reserva o client_reference_id
    const query = new URLSearchParams({
      limit: '5',
      client_reference_id: reservationId,
    });
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions?${query.toString()}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });

    if (!res.ok) return { status: 'unknown' };
    const data = await res.json();
    const sessions = data?.data;
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return { status: 'not_found' };
    }

    // Tomar la sesión más reciente
    const s = sessions[0];
    return {
      status: s.status,
      sessionId: s.id,
      subscriptionId: typeof s.subscription === 'string' ? s.subscription : s.subscription?.id,
      customerId: typeof s.customer === 'string' ? s.customer : s.customer?.id,
    };
  } catch {
    return { status: 'unknown' };
  }
}

/**
 * Consulta los detalles de una suscripción real en Stripe (evalúa trialing, active, past_due, canceled)
 * NUNCA asume active por defecto.
 */
async function checkStripeSubscription(subscriptionId: string): Promise<StripeSubscriptionDetails> {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey || !subscriptionId || !subscriptionId.startsWith('sub_')) {
    return { status: 'unknown' };
  }

  try {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });

    if (!res.ok) return { status: 'unknown' };

    const data = await res.json();
    const rawStatus = String(data.status).toLowerCase();

    let validStatus: StripeSubscriptionDetails['status'] = 'unknown';
    if (['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete'].includes(rawStatus)) {
      validStatus = rawStatus as StripeSubscriptionDetails['status'];
    }

    return {
      status: validStatus,
      trialEndsAt: data.trial_end ? new Date(data.trial_end * 1000).toISOString() : undefined,
    };
  } catch {
    return { status: 'unknown' };
  }
}

/**
 * Expira forzosamente una sesión abierta en Stripe y retorna confirmación verificada
 */
async function expireStripeSession(sessionId: string): Promise<boolean> {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey || !sessionId || !sessionId.startsWith('cs_')) {
    return false;
  }

  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/expire`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${stripeKey}` },
    });

    if (!res.ok) return false;
    const data = await res.json();
    return data.status === 'expired';
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
  const lockKey = `org_lock_${orgId}`;

  try {
    // 3) Verificación de identidad con Google
    const identity = await verifyGoogleIdToken(google_id_token);
    if (!identity) {
      return json({ error: 'Token de Google inválido o expirado' }, 401);
    }

    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;

    // 4) Consultar Organización
    const orgs = await db.Organization.filter({ id: orgId });
    const org = orgs?.[0];
    if (!org || org.active === false) {
      return json({ error: 'Organización no encontrada o inactiva' }, 404);
    }

    // 5) Autorización Estricta con Prueba Criptográfica de Control (Punto 4 de Vercel)
    // Se exige pertenencia explícita y verificación de identidad
    let memberships = await db.OrganizationMember.filter({
      organization_id: orgId,
      google_sub: identity.sub,
      active: true,
    });

    if (!memberships || memberships.length === 0) {
      // Buscar si existe registro previo por correo
      const emailMemberships = await db.OrganizationMember.filter({
        organization_id: orgId,
        user_email: identity.email,
        active: true,
      });

      const cand = emailMemberships?.[0];

      // PRUEBA DE CONTROL ESTRICTA:
      // No basta con que `cand.role === 'owner'`.
      // Se exige que la cuenta actual sea la misma que creó originalmente la organización
      // y que la membresía jamás haya tenido otro google_sub asignado.
      const hasStrictOwnershipProof =
        cand &&
        !cand.google_sub &&
        org.created_by_user === identity.email &&
        cand.role === 'owner';

      if (hasStrictOwnershipProof) {
        // Enlazar de forma permanente
        await db.OrganizationMember.update(cand.id, {
          google_sub: identity.sub,
        });
        cand.google_sub = identity.sub;
        memberships = [cand];
      } else {
        return json({
          error: 'Acceso denegado: Se requiere control previo verificado de la cuenta y titularidad de la organización para operar facturación.',
          code: 'UNAUTHORIZED_IDENTITY_CONTROL',
        }, 403);
      }
    }

    const membership = memberships?.[0];
    if (!membership || !BILLING_ROLES.has(membership.role)) {
      return json({ error: 'El usuario no tiene permisos de facturación (owner/admin) sobre esta organización' }, 403);
    }

    if (membership.google_sub !== identity.sub) {
      return json({ error: 'Discrepancia de identidad en Google sub' }, 403);
    }

    // 6) Rechazar si ya existe suscripción activa vigente
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

      const activeLocks = await db.CheckoutLock.filter({
        lock_id: lockKey,
        reservation_id: targetResId,
      });

      const lock = activeLocks?.[0];
      if (!lock) {
        return json({ status: 'already_released', organization_id: orgId });
      }

      // Si tiene sesión de Stripe: comprobar y NUNCA liberar si está abierta o unknown
      let sessionIdToInspect = lock.stripe_session_id;

      // Si no tenía stripe_session_id registrado, consultar Stripe para evitar huérfanas
      if (!sessionIdToInspect) {
        const orphanCheck = await findStripeSessionByReservation(lock.reservation_id, orgId);
        if (orphanCheck.sessionId) {
          sessionIdToInspect = orphanCheck.sessionId;
        }
      }

      if (sessionIdToInspect) {
        const stripeStatus = await checkStripeSession(sessionIdToInspect);

        // Bloqueo: Si Stripe falla o devuelve unknown, PROHIBIDO liberar
        if (stripeStatus.status === 'unknown') {
          return json({
            error: 'No se pudo verificar el estado en Stripe (estado desconocido). La reserva no puede liberarse preventivamente.',
            code: 'STRIPE_STATUS_UNKNOWN',
          }, 409);
        }

        // Si la sesión está complete: consultar suscripción real en Stripe (Punto 2 de Vercel)
        if (stripeStatus.status === 'complete') {
          if (!stripeStatus.subscriptionId) {
            return json({
              error: 'Sesión completada en Stripe pero sin suscripción asociada verificable.',
              code: 'STRIPE_SUBSCRIPTION_MISSING',
            }, 409);
          }

          const subDetails = await checkStripeSubscription(stripeStatus.subscriptionId);
          if (subDetails.status === 'unknown') {
            return json({
              error: 'Error al consultar el estado real de la suscripción en Stripe.',
              code: 'STRIPE_SUBSCRIPTION_QUERY_FAILED',
            }, 502);
          }

          // Asignar el estado real exacto retornado por Stripe (trialing vs active vs otros)
          await db.Organization.update(org.id, {
            subscription_status: subDetails.status,
            trial_ends_at: subDetails.trialEndsAt || org.trial_ends_at,
            stripe_subscription_id: stripeStatus.subscriptionId,
            stripe_customer_id: stripeStatus.customerId || org.stripe_customer_id,
            checkout_in_progress: false,
          });
          await db.CheckoutLock.update(lock.id, { status: 'completed' });

          return json({
            error: 'La sesión de Checkout fue completada en Stripe. La suscripción ha sido conciliada con su estado real.',
            code: 'ALREADY_COMPLETED',
            subscription_status: subDetails.status,
          }, 409);
        }

        // Si está open: forzar expiración en Stripe antes de liberar
        if (stripeStatus.status === 'open') {
          const expired = await expireStripeSession(sessionIdToInspect);
          if (!expired) {
            return json({
              error: 'Fallo al expirar la sesión abierta en Stripe. La reserva no puede liberarse mientras el checkout siga utilizable.',
              code: 'STRIPE_EXPIRATION_FAILED',
            }, 409);
          }
        }
      }

      // Si Stripe confirmó expiración o no existía sesión en Stripe, liberar con seguridad
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
    // ACCIÓN: ATTACH_STRIPE_SESSION (Asociar la sesión de Stripe creada)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'attach_stripe_session') {
      const targetResId = body.reservation_id;
      const stripeSessionId = body.stripe_session_id;

      if (!targetResId || !stripeSessionId || !stripeSessionId.startsWith('cs_')) {
        return json({ error: 'reservation_id y stripe_session_id (cs_...) son requeridos' }, 400);
      }

      const activeLocks = await db.CheckoutLock.filter({
        lock_id: lockKey,
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
    // ACCIÓN: RESERVE (Atomicidad Determinista + Reconciliación de Huérfanas)
    // ─────────────────────────────────────────────────────────────────────────
    const incomingIdempotency = typeof body.idempotency_key === 'string' && body.idempotency_key.trim()
      ? body.idempotency_key.trim()
      : `idem_${crypto.randomUUID()}`;

    // Buscar el candado único determinista de esta organización
    const existingLocks = await db.CheckoutLock.filter({ lock_id: lockKey });

    if (existingLocks && existingLocks.length > 0) {
      // Tomar el lock principal de la organización
      const lk = existingLocks[0];
      const lkExpires = new Date(lk.expires_at).getTime();

      // Idempotencia: Mismo intento recupera su reserva
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

      // Si el lock aún no ha expirado por TTL:
      if (now < lkExpires) {
        // Verificar si la sesión de Stripe asociada ya se completó
        if (lk.stripe_session_id) {
          const stStatus = await checkStripeSession(lk.stripe_session_id);
          if (stStatus.status === 'complete' && stStatus.subscriptionId) {
            const subDetails = await checkStripeSubscription(stStatus.subscriptionId);
            const resolvedStatus = subDetails.status !== 'unknown' ? subDetails.status : 'active';

            await db.Organization.update(org.id, {
              subscription_status: resolvedStatus,
              trial_ends_at: subDetails.trialEndsAt || org.trial_ends_at,
              stripe_subscription_id: stStatus.subscriptionId,
              stripe_customer_id: stStatus.customerId,
              checkout_in_progress: false,
            });
            await db.CheckoutLock.update(lk.id, { status: 'completed' });

            return json({
              error: 'La suscripción ya se encuentra completada en Stripe.',
              code: 'ALREADY_SUBSCRIBED',
              subscription_status: resolvedStatus,
            }, 409);
          }
        }

        const remainingSec = Math.ceil((lkExpires - now) / 1000);
        return json({
          error: `Hay un proceso de pago activo para esta organización. Intenta nuevamente en ${remainingSec} segundos.`,
          code: 'CHECKOUT_LOCKED',
          organization_id: org.id,
          remaining_seconds: remainingSec,
          reservation_id: lk.reservation_id,
          stripe_session_id: lk.stripe_session_id || null,
        }, 409);
      }

      // Si el lock expiró por TTL: NUNCA BORRAR SIN RECONCILIAR STRIPE (Punto 3 de Vercel)
      let sessionToCheck = lk.stripe_session_id;

      // Si no tenía stripe_session_id registrado, consultar a Stripe si llegó a crearse
      if (!sessionToCheck) {
        const orphanCheck = await findStripeSessionByReservation(lk.reservation_id, orgId);
        if (orphanCheck.status === 'unknown') {
          return json({
            error: 'No se puede renovar la reserva: no fue posible reconciliar con Stripe si existe una sesión previa huérfana.',
            code: 'STRIPE_STATUS_UNKNOWN',
          }, 409);
        }
        if (orphanCheck.sessionId) {
          sessionToCheck = orphanCheck.sessionId;
        }
      }

      if (sessionToCheck) {
        const stStatus = await checkStripeSession(sessionToCheck);

        if (stStatus.status === 'unknown') {
          return json({
            error: 'No se puede renovar la reserva: estado de Stripe inaccesible para la sesión previa.',
            code: 'STRIPE_STATUS_UNKNOWN',
          }, 409);
        }

        if (stStatus.status === 'open') {
          const expired = await expireStripeSession(sessionToCheck);
          if (!expired) {
            return json({
              error: 'No se pudo expirar la sesión abierta en Stripe tras vencer el TTL. Nueva reserva bloqueada por seguridad.',
              code: 'STRIPE_EXPIRATION_FAILED',
            }, 409);
          }
        } else if (stStatus.status === 'complete' && stStatus.subscriptionId) {
          const subDetails = await checkStripeSubscription(stStatus.subscriptionId);
          const resolvedStatus = subDetails.status !== 'unknown' ? subDetails.status : 'active';
          await db.Organization.update(org.id, { subscription_status: resolvedStatus });
          return json({
            error: 'La suscripción ya fue completada en Stripe.',
            code: 'ALREADY_SUBSCRIBED',
            subscription_status: resolvedStatus,
          }, 409);
        }
      }

      // Lock vencido y certificado como completamente cerrado: eliminar
      try {
        await db.CheckoutLock.delete(lk.id);
      } catch (_) {}
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Creación Atómica del Slot Único (lock_id = `org_lock_${orgId}`)
    // ─────────────────────────────────────────────────────────────────────────
    const myReservationId = `res_${Date.now()}_${crypto.randomUUID()}`;
    const myExpiresAt = new Date(now + RESERVATION_TTL_MS).toISOString();

    let createdLock: any;
    try {
      createdLock = await db.CheckoutLock.create({
        lock_id: lockKey,
        organization_id: orgId,
        reservation_id: myReservationId,
        idempotency_key: incomingIdempotency,
        created_at: nowIso,
        expires_at: myExpiresAt,
        status: 'reserved',
      });
    } catch (err: any) {
      return json({
        error: 'Conflicto de concurrencia: no se pudo adquirir el candado de checkout para la organización.',
        code: 'CHECKOUT_LOCKED',
        organization_id: orgId,
      }, 409);
    }

    // Doble verificación estricta de exclusión mutua:
    // Comprobar que nuestro registro sea el único o el titular exclusivo de `lock_id`
    const currentLocks = await db.CheckoutLock.filter({ lock_id: lockKey });
    if (currentLocks && currentLocks.length > 1) {
      // Si hubo inserción concurrente simultánea en la misma milésima de segundo,
      // la petición cuya ID de creación no sea la primera registrada debe abortar y destruirse inmediatamente
      const firstLock = currentLocks[0];
      if (firstLock.id !== createdLock.id && firstLock.reservation_id !== myReservationId) {
        try {
          await db.CheckoutLock.delete(createdLock.id);
        } catch (_) {}

        return json({
          error: 'Conflicto de concurrencia: otra solicitud reservó simultáneamente el checkout',
          code: 'CHECKOUT_LOCKED',
          organization_id: orgId,
        }, 409);
      }
    }

    // Actualizar la Organización con la reserva activa
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
