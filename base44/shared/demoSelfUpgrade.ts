// Demo → pago directo, sin administrador (decisión 18-nov-2026).
// El dueño de una empresa creada en la app (p. ej. después del demo) entra por la
// landing con Google (correo verificado) y puede pagar SU empresa sin vinculación
// previa, si y solo si:
//   1) la empresa la creó ese mismo correo (created_by_user);
//   2) ese correo es owner y es el ÚNICO miembro activo;
//   3) la membresía no tiene google_sub, o tiene el MISMO de esa cuenta de Google;
//   4) no tiene suscripción activa (real ni de prueba).
// Si se cumple, se guarda el google_sub y la procedencia en Redis con el origen
// 'demo_self_upgrade' (mismas llaves que usa la landing). Empresas con equipo,
// de otro correo o ya pagadas siguen exigiendo vinculación.
type Redis = (c: unknown[]) => Promise<any>;
const safe = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const PAID = new Set(['active', 'trialing', 'past_due']);

// Mismo script atómico que enrollment.ts: escribe procedencia + inscripción solo si
// no existen, o confirma que las existentes son iguales.
export const REGISTER_ENROLLMENT = `
local p = redis.call('GET',KEYS[1])
local e = redis.call('GET',KEYS[2])
if p or e then
 if not p or not e then return 0 end
 local proof = cjson.decode(p)
 local entry = cjson.decode(e)
 local wantp = cjson.decode(ARGV[1])
 local wante = cjson.decode(ARGV[2])
 for k,v in pairs(wantp) do if k ~= 'origin' and proof[k] ~= v then return 0 end end
 for k,v in pairs(wante) do if k ~= 'origin' and entry[k] ~= v then return 0 end end
 return 1
end
redis.call('MSET',KEYS[1],ARGV[1],KEYS[2],ARGV[2])
return 1`;

export type SelfUpgrade = { ok: true; org: any; member: any } | { ok: false; reason: string };

export async function demoSelfUpgrade(redis: Redis, db: any, identity: { sub: string; email: string }): Promise<SelfUpgrade> {
  const email = String(identity?.email || '').toLowerCase().trim();
  if (!safe(identity?.sub) || !email.includes('@')) return { ok: false, reason: 'INVALID_IDENTITY' };

  const mine = ((await db.OrganizationMember.filter({ user_email: email, active: true })) || [])
    .filter((m: any) => m.role === 'owner');
  if (mine.length !== 1) return { ok: false, reason: mine.length ? 'MULTIPLE_COMPANIES' : 'NO_COMPANY' };
  const m = mine[0];
  if (!safe(m.id) || !safe(m.organization_id)) return { ok: false, reason: 'MEMBERSHIP_INVALID' };
  if (m.google_sub && m.google_sub !== identity.sub) return { ok: false, reason: 'OTHER_GOOGLE_ACCOUNT' };

  const org = (await db.Organization.filter({ id: m.organization_id }))?.[0];
  if (!org || org.active === false) return { ok: false, reason: 'ORGANIZATION_UNAVAILABLE' };
  if (String(org.created_by_user || '').toLowerCase().trim() !== email) return { ok: false, reason: 'NOT_CREATOR' };
  if (PAID.has(org.subscription_status)) return { ok: false, reason: 'ALREADY_SUBSCRIBED' };
  if (org.stripe_live_subscription_id || org.stripe_live_customer_id || org.stripe_live_subscription_status) return { ok: false, reason: 'ALREADY_LIVE' };

  const members = (await db.OrganizationMember.filter({ organization_id: org.id, active: true })) || [];
  if (members.length !== 1 || members[0].id !== m.id) return { ok: false, reason: 'OTHER_MEMBERS' };

  const proofKey = `trucky:billing:member:v1:${org.id}:${identity.sub}`;
  const enrollKey = `trucky:billing:enrollment:v1:org:${org.id}`;
  const proof = { memberId: m.id, orgId: org.id, googleSub: identity.sub, role: 'owner' };
  const entry = { version: 1, orgId: org.id, memberId: m.id, googleSub: identity.sub, role: 'owner', origin: 'demo_self_upgrade' };
  // Primero la procedencia (si choca con otra existente, no se toca nada).
  if (await redis(['EVAL', REGISTER_ENROLLMENT, '2', proofKey, enrollKey, JSON.stringify(proof), JSON.stringify(entry)]) !== 1) {
    return { ok: false, reason: 'ENROLLMENT_CONFLICT' };
  }
  if (!m.google_sub) await db.OrganizationMember.update(m.id, { google_sub: identity.sub });
  return { ok: true, org, member: { ...m, google_sub: identity.sub } };
}
