// Minimal MongoDB-like single-record semantics used to model Base44 updateMany in tests:
// {$exists:false} = field absent; null = absent OR null; value = strict equality.
// `updated` counts MODIFIED records (an identical $set returns 0), as observed in Base44.
export function matches(rec, query, { nullMatchesNull = true } = {}) {
  for (const [k, c] of Object.entries(query)) {
    const has = Object.hasOwn(rec, k) && rec[k] !== undefined;
    if (c && typeof c === 'object' && Object.hasOwn(c, '$exists')) { if (has !== c.$exists) return false; continue; }
    if (c === null) { if (has && !(nullMatchesNull && rec[k] === null)) return false; continue; }
    if (rec[k] !== c) return false;
  }
  return true;
}
export function applyUpdate(rec, data) {
  let changed = false;
  for (const [k, v] of Object.entries(data.$set ?? {})) { if (!Object.hasOwn(rec, k) || rec[k] !== v) { rec[k] = v; changed = true; } }
  for (const k of Object.keys(data.$unset ?? {})) { if (Object.hasOwn(rec, k)) { delete rec[k]; changed = true; } }
  return changed;
}
export function updateOne(rec, query, data, opts) {
  if (!matches(rec, query, opts)) return { success: true, updated: 0, has_more: false };
  return { success: true, updated: applyUpdate(rec, data) ? 1 : 0, has_more: false };
}
