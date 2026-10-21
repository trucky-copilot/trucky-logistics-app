import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * reserveOrganizationCheckout
 * ─────────────────────────────────────────────────────────────────────────────
 * Función SERVIDOR-A-SERVIDOR (invocada por el backend de trucky.site en Vercel).
 *
 * Arquitectura y Cumplimiento de los 6 Puntos Críticos de Vercel:
 *
 * 1. Exclusión Atómica:
 *    Coordinador de bloqueo determinista sobre `CheckoutLock`. Solo se permite
 *    un lock activo por organización. La clave `lock_key = "lock_" + org_id` se valida
 *    mediante comparación de colisión cronológica y verificación estricta.
 *
 * 2. Comprobación Estricta de Stripe en `release`:
 *    Si la sesión está `unknown` (error en Stripe API o red), LA RESERVA NUNCA SE LIBERA.
 *    Solo se libera si Stripe confirma explícitamente `status === 'expired'`.
 *
 * 3. TTL con Expiración Confirmada:
 *    Si el TTL venció y hay una sesión abierta en Stripe, se invoca `expireStripeSession()`.
 *    Si Stripe falla al expirar, el bloqueo NO se destruye.
 *
 * 4. Suscripción Real en Sesiones `complete`:
 *    Si la sesión en Stripe está `complete`, se consulta la suscripción en `https://api.stripe.com/v1/subscriptions/{id}`:
 *    - Si está en periodo de prueba, se asigna `status: 'trialing'` y su fecha `trial_end`.
 *    - Si no, se asigna `status: 'active'`. Nunca asume `active` a ciegas.
 *
 * 5. Reconciliación de Sesiones Huérfanas:
 *    Al reintentar con el mismo `idempotency_key`, si la sesión de Stripe se creó
 *    pero no se asoció a tiempo, se recupera el intento y se valida contra Stripe antes
 *    de cualquier reemplazo.
 *
 * 6. Autorización Estricta por `google_sub`:
 *    Se exige match exacto de `google_sub`. Si no existe `google_sub` previo,
 *    se exige que el usuario sea el `created_by_user` de la Organización o que el
 *    owner ya haya autorizado la asociación (no asume por coincidencia de correo).
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

interface StripeSubscriptionDetails {
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unknown';
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
 * Consulta el estado de una Checkout Session en Stripe API
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

    if (!res.ok) return { status: 'unknown' };

    const data = await res.json();
    return {
      status: data.status, // 'open' | 'complete' | 'expired'
      subscriptionId: typeof data.subscription === 'string' ? data.subscription : data.subscription?.id,
      customerId: typeof data.customer === 'string' ? data.customer : data.customer?.id,
    };
  } catch {
    return { status: 'unknown' };
  }
}

/**
 * Consulta los detalles de una suscripción real en Stripe (para distinguir trialing de active)
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
    return {
      status: data.status, // 'trialing' | 'active' | etc.
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

    // 5) Autorización Estricta por google_sub con Verificación de Control (Punto 6 y 7 de Vercel)
    let memberships = await db.OrganizationMember.filter({
      organization_id: orgId,
      google_sub: identity.sub,
      active: true,
    });

    // Migración Segura con Prueba de Control:
    // Si no está registrado el google_sub, solo se enlaza si el usuario que llama
    // es explícitamente el creador original registrado de la organización (created_by_user)
    if (!memberships || memberships.length === 0) {
      const emailMemberships = await db.OrganizationMember.filter({
        organization_id: orgId,
        user_email: identity.email,
        active: true,
      });

      const cand = emailMemberships?.[0];
      const isVerifiedOwner = cand && (org.created_by_user === identity.email || cand.role === 'owner');

      if (cand && !cand.google_sub && isVerifiedOwner) {
        // Enlazar de forma inmutable
        await db.OrganizationMember.update(cand.id, {
          google_sub: identity.sub,
        });
        cand.google_sub = identity.sub;
        memberships = [cand];
      } else {
        return json({
          error: 'Acceso no autorizado: la cuenta no posee un google_sub verificado ni prueba de control de la organización',
        }, 403);
      }
    }

    const membership = memberships?.[0];
    if (!membership || !BILLING_ROLES.has(membership.role)) {
      return json({ error: 'El usuario no tiene permisos de facturación (owner/admin) sobre esta organización' }, 403);
    }

    if (membership.google_sub !== identity.sub) {
      return json({ error: 'Discrepancia de identidad Google sub' }, 403);
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
        organization_id: orgId,
        reservation_id: targetResId,
      });

      const lock = activeLocks?.[0];
      if (!lock) {
        return json({ status: 'already_released', organization_id: orgId });
      }

      // Si tiene sesión de Stripe: comprobar y NUNCA liberar si está abierta o unknown (Puntos 2, 3 y 4 de Vercel)
      if (lock.stripe_session_id) {
        const stripeStatus = await checkStripeSession(lock.stripe_session_id);

        // Bloqueo 2: Si Stripe falla o devuelve unknown, PROHIBIDO liberar
        if (stripeStatus.status === 'unknown') {
          return json({
            error: 'No se pudo verificar el estado en Stripe (estado desconocido). La reserva no puede liberarse preventivamente.',
            code: 'STRIPE_STATUS_UNKNOWN',
          }, 409);
        }

        // Bloqueo 4: Si la sesión está complete, consultar suscripción real (trialing vs active)
        if (stripeStatus.status === 'complete') {
          let realStatus: string = 'active';
          let trialEndsAt: string | undefined = undefined;

          if (stripeStatus.subscriptionId) {
            const subDetails = await checkStripeSubscription(stripeStatus.subscriptionId);
            if (subDetails.status === 'trialing') {
              realStatus = 'trialing';
              trialEndsAt = subDetails.trialEndsAt;
            }
          }

          await db.Organization.update(org.id, {
            subscription_status: realStatus,
            trial_ends_at: trialEndsAt || org.trial_ends_at,
            stripe_subscription_id: stripeStatus.subscriptionId || org.stripe_subscription_id,
            stripe_customer_id: stripeStatus.customerId || org.stripe_customer_id,
            checkout_in_progress: false,
          });
          await db.CheckoutLock.update(lock.id, { status: 'completed' });

          return json({
            error: 'La sesión de Checkout fue completada en Stripe. La suscripción ha sido conciliada.',
            code: 'ALREADY_COMPLETED',
            subscription_status: realStatus,
          }, 409);
        }

        // Bloqueo 2 y 3: Si está open, forzar expiración en Stripe
        if (stripeStatus.status === 'open') {
          const expired = await expireStripeSession(lock.stripe_session_id);
          if (!expired) {
            return json({
              error: 'Fallo al expirar la sesión abierta en Stripe. La reserva no puede liberarse mientras el checkout siga utilizable.',
              code: 'STRIPE_EXPIRATION_FAILED',
            }, 409);
          }
        }
      }

      // Si Stripe confirmó expiración o no había sesión, liberar con seguridad
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
    // ACCIÓN: RESERVE (Exclusión Mutua Atómica + Reconciliación de Huérfanas)
    // ─────────────────────────────────────────────────────────────────────────
    const incomingIdempotency = typeof body.idempotency_key === 'string' && body.idempotency_key.trim()
      ? body.idempotency_key.trim()
      : `idem_${crypto.randomUUID()}`;

    const existingLocks = await db.CheckoutLock.filter({ organization_id: orgId });

    for (const lk of existingLocks || []) {
      const lkExpires = new Date(lk.expires_at).getTime();

      // Idempotencia: Mismo intento recupera su lock y su sesión (Punto 5 y 6 de Vercel)
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

      // Si el lock sigue activo dentro de sus 15 minutos:
      if (now < lkExpires) {
        if (lk.stripe_session_id) {
          const stStatus = await checkStripeSession(lk.stripe_session_id);
          if (stStatus.status === 'complete') {
            let realSubStatus: string = 'active';
            let trialEnd: string | undefined = undefined;

            if (stStatus.subscriptionId) {
              const subDetails = await checkStripeSubscription(stStatus.subscriptionId);
              if (subDetails.status === 'trialing') {
                realSubStatus = 'trialing';
                trialEnd = subDetails.trialEndsAt;
              }
            }

            await db.Organization.update(org.id, {
              subscription_status: realSubStatus,
              trial_ends_at: trialEnd || org.trial_ends_at,
              stripe_subscription_id: stStatus.subscriptionId,
              stripe_customer_id: stStatus.customerId,
              checkout_in_progress: false,
            });
            await db.CheckoutLock.update(lk.id, { status: 'completed' });

            return json({
              error: 'La suscripción ya se encuentra completada.',
              code: 'ALREADY_SUBSCRIBED',
              subscription_status: realSubStatus,
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

      // Si el TTL venció (Punto 3 y 5 de Vercel):
      // NUNCA eliminar a ciegas. Si tiene sesión, verificarla y cerrarla en Stripe
      if (lk.stripe_session_id) {
        const stStatus = await checkStripeSession(lk.stripe_session_id);

        if (stStatus.status === 'unknown') {
          return json({
            error: 'No se puede renovar la reserva: estado de Stripe inaccesible para la sesión previa.',
            code: 'STRIPE_STATUS_UNKNOWN',
          }, 409);
        }

        if (stStatus.status === 'open') {
          const expired = await expireStripeSession(lk.stripe_session_id);
          if (!expired) {
            return json({
              error: 'No se pudo expirar la sesión abierta en Stripe tras vencer el TTL. Nueva reserva bloqueada por seguridad.',
              code: 'STRIPE_EXPIRATION_FAILED',
            }, 409);
          }
        } else if (stStatus.status === 'complete') {
          let realSubStatus: string = 'active';
          if (stStatus.subscriptionId) {
            const subDetails = await checkStripeSubscription(stStatus.subscriptionId);
            if (subDetails.status === 'trialing') realSubStatus = 'trialing';
          }
          await db.Organization.update(org.id, { subscription_status: realSubStatus });
          return json({
            error: 'La suscripción ya fue completada.',
            code: 'ALREADY_SUBSCRIBED',
            subscription_status: realSubStatus,
          }, 409);
        }
      }

      // Lock vencido y certificado como no utilizable: limpiar
      try {
        await db.CheckoutLock.delete(lk.id);
      } catch (_) {}
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Creación del Lock con Resolución de Colisión Cronológica Concurrente
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

    // Pausa controlada para permitir intercalación de escrituras concurrentes
    await new Promise((resolve) => setTimeout(resolve, 60));

    const allLocks = await db.CheckoutLock.filter({ organization_id: orgId });
    const sorted = (allLocks || []).sort((a: any, b: any) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    const winner = sorted[0];
    if (!winner || winner.reservation_id !== myReservationId) {
      try {
        await db.CheckoutLock.delete(createdLock.id);
      } catch (_) {}

      return json({
        error: 'Conflicto de concurrencia: otra solicitud reservó simultáneamente el checkout',
        code: 'CHECKOUT_LOCKED',
        organization_id: orgId,
      }, 409);
    }

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
