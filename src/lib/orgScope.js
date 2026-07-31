/**
 * orgScope — acceso a datos org-scoped, fail-closed.
 * ───────────────────────────────────────────────────
 * Helper mínimo (adapter) para que las 10+ pantallas que leen/crean
 * entidades multi-tenant (Truck, Load, Driver, Broker, Notification,
 * CarrierProfile, ...) lo hagan siempre filtrando por `organization_id`,
 * sin repetir el guard en cada call site.
 *
 * FAIL-CLOSED: si `orgId` es null/undefined (organización aún no resuelta),
 * los lectores devuelven `[]` en vez de pegarle a Base44 sin filtro. Nunca
 * se debe "fail-open" (leer todo y filtrar en cliente) — eso es justamente
 * el bug de cross-tenant que este helper previene.
 *
 * NO usar este helper para CostConfig ni UserProfile: esas dos entidades
 * son per-usuario y se filtran por email, no por organization_id.
 */

/**
 * Lista todos los registros de una entidad para la organización dada.
 * @param {object} entity  — entidad Base44 (expone `.filter(criteria, sort, limit)`)
 * @param {string|null} orgId
 * @param {string} [sort]
 * @param {number} [limit]
 * @returns {Promise<any[]>}
 */
export async function listByOrg(entity, orgId, sort, limit) {
  if (!orgId) return [];
  return entity.filter({ organization_id: orgId }, sort, limit);
}

/**
 * Lista registros de una entidad para la organización dada, combinando
 * criterios adicionales (ej. `{ active: true }`).
 * @param {object} entity
 * @param {string|null} orgId
 * @param {object} [criteria]
 * @param {string} [sort]
 * @param {number} [limit]
 * @returns {Promise<any[]>}
 */
export async function filterByOrg(entity, orgId, criteria = {}, sort, limit) {
  if (!orgId) return [];
  return entity.filter({ organization_id: orgId, ...criteria }, sort, limit);
}

/**
 * Inyecta `organization_id` en un payload antes de `.create()`.
 * @param {string|null} orgId
 * @param {object} [payload]
 * @returns {object}
 */
export function withOrg(orgId, payload = {}) {
  return { ...payload, organization_id: orgId };
}
