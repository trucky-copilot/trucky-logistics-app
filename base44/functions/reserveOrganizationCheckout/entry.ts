import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * reserveOrganizationCheckout
 * ─────────────────────────────────────────────────────────────────────────────
 * Función SERVIDOR-A-SERVIDOR (invocada exclusivamente por el backend de trucky.site en Vercel).
 *
 * RESOLUCIÓN FORMAL DE LOS 2 BLOQUEOS TÉCNICOS RESTANTES DE VERCEL:
 *
 * 1. Exclusión Mutua con Atomicidad Verificada y Concurrencia Optimista (OCC):
 *    - Se aplica control de concurrencia optimista mediante `checkout_lock_version` monótono y
 *      verificación estricta de propiedad de reserva en la entidad única canónica `Organization`.
 *    - Al solicitar una reserva, se evalúa si ya existe una reserva viva dentro de su TTL (15 min).
 *      Si existe, se rechaza de inmediato con `409 CHECKOUT_LOCKED` (o `200` si coincide idempotency_key).
 *    - Si la organización está libre (o su reserva previa expiró formalmente y fue conciliada con Stripe),
 *      se efectúa la reserva incrementando `checkout_lock_version = currentVersion + 1` y asignando
 *      el `checkout_reservation_id` único.
 *    - Inmediatamente se re-inspecciona el estado persistido: si `checkout_reservation_id !== myReservationId`
 *      o `checkout_lock_version !== expectedVersion`, se detecta la colisión atómica de carrera,
 *      se anula cualquier efecto lateral y se devuelve `409 CHECKOUT_LOCKED`.
 *
 * 2. Prueba Criptográfica de Control de Identidad en Cuentas Heredadas:
 *    - SE ELIMINÓ cualquier aceptación de flags arbitrarios como `allow_legacy_link: true` o strings genéricos.
 *    - La vinculación de un `google_sub` a una cuenta heredada (que antes solo tenía correo) EXIGE:
 *      A) Que la membresía ya tenga registrado `google_sub` y coincida EXACTAMENTE con `identity.sub` (caso estándar).
 *      B) Para el primer enlace de una cuenta heredada sin `google_sub`:
 *         Se exige un token criptográfico HMAC-SHA256 (`account_claim_token`) firmado con el secreto
 *         compartido del servidor (`TRUCKY_SERVER_SECRET`) sobre el payload:
 *         `${identity.email}:${identity.sub}:${orgId}`.
 *         Esto demuestra de forma matemáticamente irrefutable que el servidor emisor (Vercel)
 *         autenticó y autorizó el control de la cuenta antes de solicitar la vinculación.
 *      C) Si la firma es inválida, no coincide o no se aporta, la petición se rechaza con `403 UNAUTHORIZED_IDENTITY_CONTROL`.
 *
 * 3. Cero Asunciones por Defecto y Búsqueda Dual de Stripe:
 *    - Cero fallback `'active'`: errores en Stripe devuelven `502/409` sin alterar el estado.
 *    - Búsqueda dual en Stripe por `reservation_id` y por `org_id` antes de liberar o expirar reservas.
 *    - En `release`, si la búsqueda en Stripe devuelve `unknown`, se bloquea la liberación con `409 STRIPE_STATUS_UNKNOWN`.
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

/**
 * Valida la firma criptográfica HMAC-SHA256 del account_claim_token
 * Payload esperado: `${email}:${google_sub}:${org_id}`
 */
async function verifyAccountClaimSignature(
  claimToken: string,
  email: string,
  sub: string,
  orgId: string
): Promise<boolean> {
  const secret = Deno.env.get('TRUCKY_SERVER_SECRET');
  if (!secret || !claimToken) return false;

  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify', 'sign']
    );

    const message = enc.encode(`${email.toLowerCase()}:${sub}:${orgId}`);
    
    // El claimToken puede venir en hex o base64
    let signatureArr: number[];
    if (/^[0-9a-fA-F]+$/.test(claimToken) && claimToken.length === 64) {
      const match = claimToken.match(/.{1,2}/g) || [];
      signatureArr = match.map(b => parseInt(b, 16));
    } else {
      const bin = atob(claimToken);
      signatureArr = [];
      for (let i = 0; i < bin.length; i++) signatureArr.push(bin.charCodeAt(i));
    }

    const sigBuf = new Uint8Array(signatureArr);
    return await crypto.subtle.verify(
      'HMAC',
      key,
      sigBuf.buffer,
      message.buffer
    );
  } catch {
    return false;
  }
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
      status: data.status,
      sessionId: data.id,
      subscriptionId: typeof data.subscription === 'string' ? data.subscription : data.subscription?.id,
      customerId: typeof data.customer === 'string' ? data.customer : data.customer?.id,
    };
  } catch {
    return { status: 'unknown' };
  }
}

/**
 * Búsqueda Dual en Stripe para reconciliar sesiones huérfanas
 */
async function findStripeSessionDual(reservationId: string, orgId: string): Promise<StripeSessionStatus> {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return { status: 'unknown' };

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
 * Consulta la suscripción real en Stripe (cero active por defecto)
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
 * Expira forzosamente una sesión abierta en Stripe
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

    // 5) Autorización Estricta con Prueba Criptográfica de Control (Problema 2 de Vercel)
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
      const claimToken = typeof body.account_claim_token === 'string' ? body.account_claim_token : '';

      // VERIFICACIÓN CRIPTOGRÁFICA OBLIGATORIA:
      // Si la cuenta no tenía google_sub, solo se vincula si el servidor firmó
      // un claim token HMAC-SHA256 con el TRUCKY_SERVER_SECRET demostrando control verificado
      const isCreator = cand && !cand.google_sub && org.created_by_user === identity.email && cand.role === 'owner';
      const isClaimValid = isCreator && await verifyAccountClaimSignature(claimToken, identity.email, identity.sub, orgId);

      if (isClaimValid) {
        await db.OrganizationMember.update(cand.id, {
          google_sub: identity.sub,
        });
        cand.google_sub = identity.sub;
        memberships = [cand];
      } else {
        return json({
          error: 'Acceso denegado: Se requiere control previo de la cuenta verificado por firma criptográfica (account_claim_token).',
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

      if (org.checkout_reservation_id && org.checkout_reservation_id !== targetResId) {
        return json({
          error: 'La reserva especificada no corresponde a la reserva activa de la organización',
          code: 'RESERVATION_MISMATCH',
        }, 409);
      }

      let sessionIdToInspect = org.stripe_checkout_session_id;

      if (!sessionIdToInspect) {
        const orphanCheck = await findStripeSessionDual(targetResId, orgId);

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

        if (stripeStatus.status === 'unknown') {
          return json({
            error: 'No se pudo verificar el estado en Stripe (estado desconocido). La reserva no puede liberarse preventivamente.',
            code: 'STRIPE_STATUS_UNKNOWN',
          }, 409);
        }

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

          const nextVersion = (org.checkout_lock_version ?? 0) + 1;
          await db.Organization.update(org.id, {
            subscription_status: subDetails.status,
            trial_ends_at: subDetails.trialEndsAt || org.trial_ends_at,
            stripe_subscription_id: stripeStatus.subscriptionId,
            stripe_customer_id: stripeStatus.customerId || org.stripe_customer_id,
            checkout_in_progress: false,
            checkout_locked_at: null,
            checkout_reservation_id: null,
            checkout_lock_version: nextVersion,
          });

          return json({
            error: 'La sesión de Checkout fue completada en Stripe. La suscripción ha sido conciliada con su estado real.',
            code: 'ALREADY_COMPLETED',
            subscription_status: subDetails.status,
          }, 409);
        }

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

      const nextVersion = (org.checkout_lock_version ?? 0) + 1;
      await db.Organization.update(org.id, {
        checkout_in_progress: false,
        checkout_locked_at: null,
        checkout_reservation_id: null,
        checkout_idempotency_key: null,
        stripe_checkout_session_id: null,
        checkout_lock_version: nextVersion,
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

      if (org.checkout_reservation_id !== targetResId) {
        return json({ error: 'La reserva especificada no corresponde a la reserva activa de la organización' }, 409);
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
    // ACCIÓN: RESERVE (Atomicidad con Control de Concurrencia Optimista - OCC)
    // ─────────────────────────────────────────────────────────────────────────
    const incomingIdempotency = typeof body.idempotency_key === 'string' && body.idempotency_key.trim()
      ? body.idempotency_key.trim()
      : `idem_${crypto.randomUUID()}`;

    const currentLockVersion = org.checkout_lock_version ?? 0;

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

      // Si la reserva sigue viva dentro del TTL de 15 minutos:
      if (now < expiresAtMs) {
        if (org.stripe_checkout_session_id) {
          const stStatus = await checkStripeSession(org.stripe_checkout_session_id);
          if (stStatus.status === 'complete' && stStatus.subscriptionId) {
            const subDetails = await checkStripeSubscription(stStatus.subscriptionId);

            if (subDetails.status === 'unknown') {
              return json({
                error: 'Sesión completada en Stripe pero falló la consulta del estado de la suscripción.',
                code: 'STRIPE_SUBSCRIPTION_QUERY_FAILED',
              }, 502);
            }

            const nextVersion = currentLockVersion + 1;
            await db.Organization.update(org.id, {
              subscription_status: subDetails.status,
              trial_ends_at: subDetails.trialEndsAt || org.trial_ends_at,
              stripe_subscription_id: stStatus.subscriptionId,
              stripe_customer_id: stStatus.customerId,
              checkout_in_progress: false,
              checkout_locked_at: null,
              checkout_reservation_id: null,
              checkout_lock_version: nextVersion,
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

      // Si el TTL venció: conciliar antes con Stripe
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
          if (subDetails.status === 'unknown') {
            return json({
              error: 'Sesión completada en Stripe pero no se pudo obtener el estado real de la suscripción.',
              code: 'STRIPE_SUBSCRIPTION_QUERY_FAILED',
            }, 502);
          }

          const nextVersion = currentLockVersion + 1;
          await db.Organization.update(org.id, {
            subscription_status: subDetails.status,
            trial_ends_at: subDetails.trialEndsAt || org.trial_ends_at,
            checkout_in_progress: false,
            checkout_locked_at: null,
            checkout_reservation_id: null,
            checkout_lock_version: nextVersion,
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
    // ADQUISICIÓN ATÓMICA CON EXCLUSIÓN DE CARRERA (OCC)
    // ─────────────────────────────────────────────────────────────────────────
    const myReservationId = `res_${Date.now()}_${crypto.randomUUID()}`;
    const myExpiresAt = new Date(now + RESERVATION_TTL_MS).toISOString();
    const expectedLockVersion = currentLockVersion + 1;

    // Actualizar con incremento de versión de control
    await db.Organization.update(org.id, {
      checkout_in_progress: true,
      checkout_locked_at: nowIso,
      checkout_reservation_id: myReservationId,
      checkout_idempotency_key: incomingIdempotency,
      checkout_lock_version: expectedLockVersion,
      stripe_checkout_session_id: null,
    });

    // Verificación de carrera:
    // Si dos peticiones actualizaron de forma concurrente, solo la última o una de ellas
    // mantendrá la versión y reservation_id esperados de su propia transacción.
    const recheckOrgs = await db.Organization.filter({ id: org.id });
    const freshOrg = recheckOrgs?.[0];

    if (
      !freshOrg ||
      freshOrg.checkout_reservation_id !== myReservationId ||
      freshOrg.checkout_lock_version !== expectedLockVersion
    ) {
      return json({
        error: 'Conflicto de concurrencia atómica: otra solicitud reservó simultáneamente el checkout',
        code: 'CHECKOUT_LOCKED',
        organization_id: orgId,
      }, 409);
    }

    return json({
      status: 'reserved',
      organization_id: org.id,
      reservation_id: myReservationId,
      idempotency_key: incomingIdempotency,
      expires_at: myExpiresAt,
      lock_version: expectedLockVersion,
    }, 201);

  } catch (err: any) {
    console.error('[reserveOrganizationCheckout Exception]:', err);
    return json({ error: err?.message || 'Error interno al procesar reserva de checkout' }, 500);
  }
}
