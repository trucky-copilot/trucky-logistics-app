// Recupera empresas creadas por la landing que quedaron SIN procedencia en Redis
// (QA 18/19-nov-2026). Solo con evidencia del servidor, nunca por correo:
//   - membresía owner activa con google_sub = la cuenta de Google verificada
//     (ese google_sub solo lo escribe el servidor al crear la empresa);
//   - es el ÚNICO miembro activo de la empresa;
//   - existe la llave de intento de creación de la landing para ESA cuenta de
//     Google y ESE nombre de empresa (trucky:billing:create:v1:attempt:<hash> o
//     trucky:demo:test:create:<hash>), pendiente o apuntando a esa empresa;
//   - sin suscripción real.
// Si se cumple, registra la procedencia + inscripción con origen landing_public_new
// (las mismas llaves que escribe la creación normal) y marca el intento como terminado.
type Redis = (c: unknown[]) => Promise<any>;
const safe = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);

export const REGISTER_ENROLLMENT = `
local p = redis.call('GET',KEYS[1])
local e = redis.call('GET',KEYS[2])
if p or e then
 if not p or not e then return 0 end
 local proof = cjson.decode(p)
 local entry = cjson.decode(e)
 local wantp = cjson.decode(ARGV[1])
 local wante = cjson.decode(ARGV[2])
 for k,v in pairs(wantp) do if proof[k] ~= v then return 0 end end
 for k,v in pairs(wante) do if k ~= 'origin' and entry[k] ~= v then return 0 end end
 return 1
end
redis.call('MSET',KEYS[1],ARGV[1],KEYS[2],ARGV[2])
return 1`;

export async function creationHash(sub: string, name: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${sub}:${String(name).toLowerCase()}`));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type LandingRepair = { repaired: true; org: any } | { repaired: false; reason: string };

export async function repairLandingProvenance(redis: Redis, db: any, sub: string, orgId?: string): Promise<LandingRepair> {
  if (!safe(sub) || (orgId !== undefined && !safe(orgId))) return { repaired: false, reason: 'INVALID_INPUT' };
  const mine = ((await db.OrganizationMember.filter({ google_sub: sub, active: true, role: 'owner' })) || [])
    .filter((m: any) => orgId === undefined || m.organization_id === orgId);
  if (mine.length !== 1) return { repaired: false, reason: mine.length ? 'MULTIPLE_MEMBERSHIPS' : 'NO_MEMBERSHIP' };
  const m = mine[0];
  if (!safe(m.id) || !safe(m.organization_id) || m.google_sub !== sub) return { repaired: false, reason: 'MEMBERSHIP_INVALID' };

  const org = (await db.Organization.filter({ id: m.organization_id }))?.[0];
  if (!org || org.active === false || typeof org.name !== 'string') return { repaired: false, reason: 'ORGANIZATION_UNAVAILABLE' };
  if (org.stripe_live_subscription_id || org.stripe_live_customer_id) return { repaired: false, reason: 'ALREADY_LIVE' };

  const members = (await db.OrganizationMember.filter({ organization_id: org.id, active: true })) || [];
  if (members.length !== 1 || members[0].id !== m.id) return { repaired: false, reason: 'OTHER_MEMBERS' };

  const proofKey = `trucky:billing:member:v1:${org.id}:${sub}`;
  const enrollKey = `trucky:billing:enrollment:v1:org:${org.id}`;
  // Ya completa: nada que reparar.
  if (await redis(['GET', proofKey]) && await redis(['GET', enrollKey])) return { repaired: false, reason: 'ALREADY_COMPLETE' };

  const hash = await creationHash(sub, org.name);
  const billingKey = `trucky:billing:create:v1:attempt:${hash}`;
  const billingAttempt = await redis(['GET', billingKey]);
  const demoAttempt = await redis(['GET', `trucky:demo:test:create:${hash}`]);
  const isOrgId = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v);
  // Evidencia válida: intento pendiente (aún sin empresa) o terminado en ESTA empresa.
  const billingOk = billingAttempt != null && (!isOrgId(billingAttempt) || billingAttempt === org.id);
  const demoOk = demoAttempt != null && (demoAttempt === 'pending' || demoAttempt === org.id);
  if (!billingOk && !demoOk) return { repaired: false, reason: 'NO_LANDING_EVIDENCE' };

  const proof = { memberId: m.id, orgId: org.id, googleSub: sub, role: 'owner' };
  const entry = { version: 1, orgId: org.id, memberId: m.id, googleSub: sub, role: 'owner', origin: 'landing_public_new' };
  if (await redis(['EVAL', REGISTER_ENROLLMENT, '2', proofKey, enrollKey, JSON.stringify(proof), JSON.stringify(entry)]) !== 1) {
    return { repaired: false, reason: 'ENROLLMENT_CONFLICT' };
  }
  if (billingAttempt != null) await redis(['SET', billingKey, org.id]);
  return { repaired: true, org };
}
