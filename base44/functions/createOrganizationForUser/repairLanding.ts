// Reparación de empresas creadas A MEDIAS por la landing (QA 18-nov-2026).
// Si la creación se cortó después de crear la empresa y la membresía, quedaba
// sin procedencia en Redis: la elegibilidad respondía BILLING_ACCOUNT_REVIEW_REQUIRED
// y cada reintento daba 409. Aquí se completa el registro SOLO con evidencia del
// servidor: la llave de intento de creación de ESTA cuenta de Google y ESTE nombre
// de empresa. Nunca se adopta una empresa creada en la app ni una con otros miembros.
import { registerNewEnrollment } from './enrollment.ts';

type Redis = (c: unknown[]) => Promise<any>;
const safe = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);

export async function creationHash(sub: string, name: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${sub}:${String(name).toLowerCase()}`));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type RepairResult =
  | { repaired: true; org: any }
  | { repaired: false; reason: string };

export async function repairHalfCreatedLanding(
  redis: Redis,
  db: any,
  identity: { sub: string; email: string },
): Promise<RepairResult> {
  if (!safe(identity?.sub)) return { repaired: false, reason: 'INVALID_IDENTITY' };
  const mine = (await db.OrganizationMember.filter({ google_sub: identity.sub, active: true, role: 'owner' })) || [];
  if (mine.length !== 1) return { repaired: false, reason: mine.length ? 'MULTIPLE_MEMBERSHIPS' : 'NO_MEMBERSHIP' };
  const m = mine[0];
  if (!safe(m.id) || !safe(m.organization_id) || String(m.user_email || '').toLowerCase() !== identity.email) return { repaired: false, reason: 'MEMBERSHIP_MISMATCH' };

  const org = (await db.Organization.filter({ id: m.organization_id }))?.[0];
  if (!org || org.active === false || String(org.created_by_user || '').toLowerCase() !== identity.email) return { repaired: false, reason: 'ORGANIZATION_MISMATCH' };
  if (org.stripe_live_subscription_id || org.stripe_live_customer_id) return { repaired: false, reason: 'ALREADY_LIVE' };

  const members = (await db.OrganizationMember.filter({ organization_id: org.id, active: true })) || [];
  if (members.length !== 1 || members[0].id !== m.id) return { repaired: false, reason: 'OTHER_MEMBERS' };

  // Evidencia del servidor: intento de creación de la landing para esta cuenta + nombre.
  const hash = await creationHash(identity.sub, org.name);
  const billingKey = `trucky:billing:create:v1:attempt:${hash}`;
  const demoKey = `trucky:demo:test:create:${hash}`;
  const billingAttempt = await redis(['GET', billingKey]);
  const demoAttempt = billingAttempt == null ? await redis(['GET', demoKey]) : null;
  if (billingAttempt == null && demoAttempt == null) return { repaired: false, reason: 'NO_LANDING_EVIDENCE' };
  const attempt = billingAttempt ?? demoAttempt;
  // Ya finalizado para OTRA empresa: no se toca.
  if (safe(attempt) && attempt !== org.id && /^[0-9a-f]{24}$/i.test(attempt)) return { repaired: false, reason: 'ATTEMPT_OTHER_ORGANIZATION' };

  // Completa procedencia + inscripción (idempotente: si ya existen iguales, no cambia nada).
  try {
    await registerNewEnrollment(redis, org, { id: m.id, organization_id: org.id, google_sub: m.google_sub, role: m.role, active: m.active });
  } catch {
    // Procedencia existente pero distinta: requiere revisión, no se sobrescribe.
    return { repaired: false, reason: 'ENROLLMENT_CONFLICT' };
  }
  await redis(['SET', billingKey, org.id]);
  return { repaired: true, org };
}
