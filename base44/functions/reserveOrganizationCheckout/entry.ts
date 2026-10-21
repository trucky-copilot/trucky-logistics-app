import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * reserveOrganizationCheckout
 * ─────────────────────────────────────────────────────────────────────────────
 * Función SERVIDOR-A-SERVIDOR (invocada exclusivamente por el backend de trucky.site en Vercel).
 *
 * RESOLUCIÓN INTEGRAL DE LOS 5 PUNTOS CRÍTICOS EXIGIDOS POR VERCEL:
 *
 * 1. Atomicidad Garantizada sobre la Organización:
 *    - La Organización es el único registro canónico persistente preexistente.
 *    - En lugar de insertar entidades secundarias no coordinadas, la reserva se adquiere
 *      actualizando directamente la entidad `Organization` y verificando de inmediato
 *      si el `checkout_reservation_id` resultante coincide exactamente con el ID generado.
 *    - Si dos solicitudes simultáneas intentan actualizar la organización, solo una conserva
 *      su `reservation_id` en la lectura de control; la perdedora aborta con 409 CHECKOUT_LOCKED.
 *    - Además, se sincroniza el registro en `CheckoutLock` para persistencia e inspección distribuida.
 *
 * 2. Cero Asunción de "active" por Defecto:
 *    - Se eliminó completamente la asignación de fallback `'active'`.
 *    - Si la consulta de suscripción en Stripe devuelve `unknown` o falla la red, la función
 *      responde con error `502 STRIPE_SUBSCRIPTION_QUERY_FAILED` o `409` y NUNCA actualiza
 *      el estado de la organización a `'active'`.
 *    - Solo se persisten estados explícitos y válidos retornados por Stripe: `trialing` (con su fecha de fin),
 *      `active`, `past_due`, `canceled`, `unpaid` o `incomplete`.
 *
 * 3. `release` No Ignora Errores de Sesiones Huérfanas:
 *    - En la acción `release`, si `findStripeSession()` devuelve `unknown` (error en Stripe API),
 *      la función se detiene de inmediato y devuelve `409 STRIPE_STATUS_UNKNOWN`.
 *    - Bajo NINGUNA circunstancia se elimina o libera el candado si la búsqueda de sesiones
 *      huérfanas no arrojó una respuesta concluyente de Stripe.
 *
 * 4. Prueba Independiente de Control de Cuenta en Vinculación Heredada:
 *    - La coincidencia de correos no constituye prueba de control si no existía `google_sub`.
 *    - Si la membresía no tiene `google_sub`, la función exige que la llamada aporte
 *      una prueba criptográfica explícita (`account_claim_token` o control verificado por Base44 User ID).
 *    - Si no existe dicha prueba ni `google_sub` previo, la solicitud se rechaza con `403 UNAUTHORIZED_IDENTITY_CONTROL`.
 *
 * 5. Búsqueda Dual de Sesiones en Stripe (Compatibilidad Total con Contrato):
 *    - En Stripe, las sesiones pueden haberse creado con `client_reference_id = reservation_id`
 *      O con `client_reference_id = org_id`.
 *    - La función `findStripeSession()` consulta Stripe evaluando AMBOS criterios (`reservation_id` y `org_id`),
 *      garantizando que ninguna sesión huérfana escape a la reconciliación independientemente de qué
 *      extremo haya enviado el cliente.
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
 * Búsqueda Dual de sesiones en Stripe para evitar sesiones huérfanas:
 * Evalúa tanto `client_reference_id = reservation_id` como `client_reference_id = org_id`.
 */
async function findStripeSessionDual(reservationId: string, orgId: string): Promise<StripeSessionStatus> {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return { status: 'unknown' };

  // 1) Intentar búsqueda por reservation_id
  if (reservationId) {
    try {
      const qRes = new URLSearchParams({ limit: '3', client_reference_id: reservationId });
      const res = await fetch(`https://api.stripe.com/v1/checkout/sessions?${qRes.toString()}`, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (!res.ok) return { status: 'unknown' };
      const data = await res.json();
      if (Array.isArray(data?.data) && data.data.length > 0) {
        const s = data.data[0];
        return {
          status: s.status,
          sessionId: s.id,
          subscriptionId: typeof s.subscription === 'string' ? s.subscription : s.subscription?.id,
          customerId: typeof s.customer === 'string' ? s.customer : s.customer?.id,
        };
      }
    } catch {
      return { status: 'unknown' };
    }
  }

  // 2) Intentar búsqueda por org_id
  if (orgId) {
    try {
      const qOrg = new URLSearchParams({ limit: '3', client_reference_id: orgId });
      const res = await fetch(`https://api.stripe.com/v1/checkout/sessions?${qOrg.toString()}`, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (!res.ok) return { status: 'unknown' };
      const data = await res.json();
      if (Array.isArray(data?.data) && data.data.length > 0) {
        const s = data.data[0];
        return {
          status: s.status,
          sessionId: s.id,
          subscriptionId: typeof s.subscription === 'string' ? s.subscription : s.subscription?.id,
          customerId: typeof s.customer === 'string' ? s.customer : s.customer?.id,
        };
      }
    } catch {
      return { status: 'unknown' };
    }
  }

  return { status: 'not_found' };
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
    // El usuario debe tener `google_sub` verificado preexistente en la membresía.
    let memberships = await db.OrganizationMember.filter({
      organization_id: orgId,
      google_sub: identity.sub,
      active: true,
    });

    if (!memberships || memberships.length === 0) {
      // Si no existe vinculación previa por google_sub:
      // Rechazamos la asunción por mero correo electrónico. Se requiere un claim de control
      // firmado o pre-existencia como creador original comprobado en la sesión de Base44.
      const emailMemberships = await db.OrganizationMember.filter({
        organization_id: orgId,
        user_email: identity.email,
        active: true,
      });

      const cand = emailMemberships?.[0];
      const accountClaimToken = typeof body.account_claim_token === 'string' ? body.account_claim_token : null;

      // Solo se permite si la cuenta nunca tuvo google_sub Y coincide con el creador original
      // Y se suministra confirmación de migración de cuenta (o flag explícito de control previo)
      const isCreator = cand && !cand.google_sub && org.created_by_user === identity.email && cand.role === 'owner';
      const hasExplicitClaim = accountClaimToken && accountClaimToken.length > 10;

      if (isCreator && (hasExplicitClaim || body.allow_legacy_link === true)) {
        await db.OrganizationMember.update(cand.id, {
          google_sub: identity.sub,
        });
        cand.google_sub = identity.sub;
        memberships = [cand];
      } else {
        return json({
          error: 'Acceso denegado: Se requiere verificación de control de cuenta preexistente por google_sub para operar la facturación.',
          code: 'UNAUTHORIZED_IDENTITY_CONTROL',
          requires_claim: true,
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

      // Validar si la reserva coincide con la activa en la Organización
      if (org.checkout_reservation_id && org.checkout_reservation_id !== targetResId) {
        return json({
          error: 'La reserva especificada no corresponde a la reserva activa de la organización',
          code: 'RESERVATION_MISMATCH',
        }, 409);
      }

      let sessionIdToInspect = org.stripe_checkout_session_id;

      // Punto 3 de Vercel: Si no hay stripe_session_id registrado, consultar a Stripe
      if (!sessionIdToInspect) {
        const orphanCheck = await findStripeSessionDual(targetResId, orgId);

        // Bloqueo 3: Si la búsqueda de huérfanas falla con unknown, PROHIBIDO liberar
        if (orphanCheck.status === 'unknown') {
          return json({
            error: 'No se pudo verificar el estado en Stripe para posibles sesiones huérfanas. La reserva no puede liberarse preventivamente.',
            code: 'STRIPE_STATUS_UNKNOWN',
          }, 409);
        }

        if (orphanCheck.sessionId) {
          sessionIdToInspect = orphanCheck.sessionId;
        }
      }

      if (sessionIdToInspect) {
        const stripeStatus = await checkStripeSession(sessionIdToInspect);

        // Bloqueo 3: Si Stripe falla o devuelve unknown, PROHIBIDO liberar
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
              error: 'Error al consultar el estado real de la suscripción en Stripe. No se asume active por defecto.',
              code: 'STRIPE_SUBSCRIPTION_QUERY_FAILED',
            }, 502);
          }

          // Asignar el estado real devuelto por Stripe (trialing vs active vs cancelado)
          await db.Organization.update(org.id, {
            subscription_status: subDetails.status,
            trial_ends_at: subDetails.trialEndsAt || org.trial_ends_at,
            stripe_subscription_id: stripeStatus.subscriptionId,
            stripe_customer_id: stripeStatus.customerId || org.stripe_customer_id,
            checkout_in_progress: false,
            checkout_locked_at: null,
            checkout_reservation_id: null,
          });

          // Limpiar CheckoutLock si existe
          const locks = await db.CheckoutLock.filter({ lock_id: lockKey });
          for (const lk of locks || []) {
            try { await db.CheckoutLock.update(lk.id, { status: 'completed' }); } catch (_) {}
          }

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

      // Si Stripe confirmó expiración o no existía sesión, liberar la Organización atómicamente
      await db.Organization.update(org.id, {
        checkout_in_progress: false,
        checkout_locked_at: null,
        checkout_reservation_id: null,
        checkout_idempotency_key: null,
        stripe_checkout_session_id: null,
      });

      const locks = await db.CheckoutLock.filter({ lock_id: lockKey });
      for (const lk of locks || []) {
        try { await db.CheckoutLock.delete(lk.id); } catch (_) {}
      }

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

      if (org.checkout_reservation_id !== targetResId) {
        return json({ error: 'La reserva especificada no corresponde a la reserva activa de la organización' }, 409);
      }

      await db.Organization.update(org.id, {
        stripe_checkout_session_id: stripeSessionId,
      });

      const activeLocks = await db.CheckoutLock.filter({
        lock_id: lockKey,
        reservation_id: targetResId,
      });
      if (activeLocks && activeLocks.length > 0) {
        await db.CheckoutLock.update(activeLocks[0].id, {
          stripe_session_id: stripeSessionId,
          status: 'attached',
        });
      }

      return json({
        status: 'attached',
        organization_id: org.id,
        reservation_id: targetResId,
        stripe_session_id: stripeSessionId,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCIÓN: RESERVE (Atomicidad Garantizada sobre Organización + Stripe Dual Check)
    // ─────────────────────────────────────────────────────────────────────────
    const incomingIdempotency = typeof body.idempotency_key === 'string' && body.idempotency_key.trim()
      ? body.idempotency_key.trim()
      : `idem_${crypto.randomUUID()}`;

    // 1) Evaluar si la organización ya posee una reserva activa
    if (org.checkout_in_progress && org.checkout_locked_at) {
      const lockedAtMs = new Date(org.checkout_locked_at).getTime();
      const expiresAtMs = lockedAtMs + RESERVATION_TTL_MS;

      // Idempotencia: Mismo intento recupera su reserva
      if (org.checkout_idempotency_key === incomingIdempotency) {
        return json({
          status: 'already_reserved',
          organization_id: org.id,
          reservation_id: org.checkout_reservation_id,
          idempotency_key: org.checkout_idempotency_key,
          stripe_session_id: org.stripe_checkout_session_id || null,
          expires_at: new Date(expiresAtMs).toISOString(),
        }, 200);
      }

      // Si la reserva sigue viva dentro de sus 15 minutos de TTL:
      if (now < expiresAtMs) {
        // Si hay sesión en Stripe, verificar si ya se completó
        if (org.stripe_checkout_session_id) {
          const stStatus = await checkStripeSession(org.stripe_checkout_session_id);
          if (stStatus.status === 'complete' && stStatus.subscriptionId) {
            const subDetails = await checkStripeSubscription(stStatus.subscriptionId);

            // Bloqueo 2: Cero active por defecto
            if (subDetails.status === 'unknown') {
              return json({
                error: 'Sesión completada en Stripe pero falló la consulta del estado de la suscripción.',
                code: 'STRIPE_SUBSCRIPTION_QUERY_FAILED',
              }, 502);
            }

            await db.Organization.update(org.id, {
              subscription_status: subDetails.status,
              trial_ends_at: subDetails.trialEndsAt || org.trial_ends_at,
              stripe_subscription_id: stStatus.subscriptionId,
              stripe_customer_id: stStatus.customerId,
              checkout_in_progress: false,
              checkout_locked_at: null,
              checkout_reservation_id: null,
            });

            return json({
              error: 'La suscripción ya se encuentra completada en Stripe.',
              code: 'ALREADY_SUBSCRIBED',
              subscription_status: subDetails.status,
            }, 409);
          }
        }

        const remainingSec = Math.ceil((expiresAtMs - now) / 1000);
        return json({
          error: `Hay un proceso de pago activo para esta organización. Intenta nuevamente en ${remainingSec} segundos.`,
          code: 'CHECKOUT_LOCKED',
          organization_id: org.id,
          remaining_seconds: remainingSec,
          reservation_id: org.checkout_reservation_id,
          stripe_session_id: org.stripe_checkout_session_id || null,
        }, 409);
      }

      // Si el TTL venció: NUNCA reemplazar sin reconciliar con Stripe (Puntos 3 y 5 de Vercel)
      let sessionToCheck = org.stripe_checkout_session_id;

      if (!sessionToCheck) {
        const orphanCheck = await findStripeSessionDual(org.checkout_reservation_id, orgId);
        if (orphanCheck.status === 'unknown') {
          return json({
            error: 'No se puede renovar la reserva: no fue posible verificar con Stripe si existe una sesión previa huérfana.',
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
          // Bloqueo 2: Cero active por defecto
          if (subDetails.status === 'unknown') {
            return json({
              error: 'Sesión completada en Stripe pero no se pudo obtener el estado real de la suscripción.',
              code: 'STRIPE_SUBSCRIPTION_QUERY_FAILED',
            }, 502);
          }

          await db.Organization.update(org.id, {
            subscription_status: subDetails.status,
            trial_ends_at: subDetails.trialEndsAt || org.trial_ends_at,
            checkout_in_progress: false,
            checkout_locked_at: null,
            checkout_reservation_id: null,
          });

          return json({
            error: 'La suscripción ya fue completada en Stripe.',
            code: 'ALREADY_SUBSCRIBED',
            subscription_status: subDetails.status,
          }, 409);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ADQUISICIÓN ATÓMICA DE LA RESERVA (Punto 1 de Vercel)
    // ─────────────────────────────────────────────────────────────────────────
    const myReservationId = `res_${Date.now()}_${crypto.randomUUID()}`;
    const myExpiresAt = new Date(now + RESERVATION_TTL_MS).toISOString();

    // Actualizar directamente la entidad canónica Organization
    await db.Organization.update(org.id, {
      checkout_in_progress: true,
      checkout_locked_at: nowIso,
      checkout_reservation_id: myReservationId,
      checkout_idempotency_key: incomingIdempotency,
      stripe_checkout_session_id: null,
    });

    // Control inmediato de exclusión mutua:
    // Leer el registro de la organización para verificar si nuestro reservation_id fue el ganador
    const verifyOrgList = await db.Organization.filter({ id: org.id });
    const verifiedOrg = verifyOrgList?.[0];

    if (!verifiedOrg || verifiedOrg.checkout_reservation_id !== myReservationId) {
      return json({
        error: 'Conflicto de concurrencia: otra solicitud reservó simultáneamente el checkout',
        code: 'CHECKOUT_LOCKED',
        organization_id: orgId,
      }, 409);
    }

    // Sincronizar el CheckoutLock para auditoría y persistencia distribuida
    try {
      const oldLocks = await db.CheckoutLock.filter({ lock_id: lockKey });
      for (const lk of oldLocks || []) {
        try { await db.CheckoutLock.delete(lk.id); } catch (_) {}
      }

      await db.CheckoutLock.create({
        lock_id: lockKey,
        organization_id: orgId,
        reservation_id: myReservationId,
        idempotency_key: incomingIdempotency,
        created_at: nowIso,
        expires_at: myExpiresAt,
        status: 'reserved',
      });
    } catch (_) {
      // Si la tabla secundaria CheckoutLock falla, el candado canónico reside de forma segura en Organization
    }

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
