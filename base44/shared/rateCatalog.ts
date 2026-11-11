// ─────────────────────────────────────────────────────────────────────────────
// F6-01 · Catálogo de tarifas en base de datos — dominio puro (sin red, sin IA).
//
// Tres responsabilidades, todas deterministas y testeables con deno test:
//   1. SEMILLA:   JSON versionados (marketChat/data) → filas de entidad.
//   2. INVERSA:   filas de entidad → la MISMA forma que hoy consume rateTable /
//                 nameResolution (RouteRecord, AccessorialRecord, aliases).
//                 Es lo que Fase C usará para que el chat lea de la base sin
//                 tocar la lógica del cotizador.
//   3. UPSERT:    compara semilla vs base y decide crear / actualizar / igual,
//                 con el detalle de qué campos cambian (para el historial).
// ─────────────────────────────────────────────────────────────────────────────

import routesFl from '../functions/marketChat/data/routes.fl.json' with { type: 'json' };
import routesTx from '../functions/marketChat/data/routes.tx.json' with { type: 'json' };
import accFl from '../functions/marketChat/data/accessorials.fl.json' with { type: 'json' };
import accTx from '../functions/marketChat/data/accessorials.tx.json' with { type: 'json' };
import aliasesRaw from '../functions/marketChat/data/aliases.json' with { type: 'json' };

export type CatalogEntity = 'RateRoute' | 'RateAccessorial' | 'RateAlias' | 'RateZone';

export const KEY_FIELD: Record<CatalogEntity, string> = {
  RateRoute: 'route_id',
  RateAccessorial: 'accessorial_key',
  RateAlias: 'alias_key',
  RateZone: 'zone_key',
};

// Campos de negocio que se comparan/escriben. Los de auditoría (actualizado_por,
// origen, notas) y los que pone Base44 (id, created_date...) NO cuentan como
// diferencia de tarifa.
export const BUSINESS_FIELDS: Record<CatalogEntity, string[]> = {
  RateRoute: ['route_id', 'orden', 'estado', 'mercado', 'ciudad', 'zona', 'grupo', 'millas_ida', 'precios', 'fuente', 'semantica_millas', 'activo'],
  RateAccessorial: ['accessorial_key', 'orden', 'estado', 'concepto', 'gatillo', 'monto', 'nota', 'fuente', 'activo'],
  RateAlias: ['alias_key', 'orden', 'estado', 'tipo', 'clave', 'valor', 'activo'],
  RateZone: ['zone_key', 'orden', 'estado', 'zona', 'activo'],
};

type Row = Record<string, any>;

// ── 1. SEMILLA ───────────────────────────────────────────────────────────────

export function seedRoutes(): Row[] {
  const all = [...(routesFl as any[]), ...(routesTx as any[])];
  return all.map((r, i) => {
    const { id, ...rest } = r;              // `id` es reservado por Base44 → route_id
    return { route_id: id, orden: i, ...rest, activo: true };
  });
}

export function seedAccessorials(): Row[] {
  const out: Row[] = [];
  for (const [estado, list] of [['FL', accFl], ['TX', accTx]] as const) {
    (list as any[]).forEach((a, i) => {
      out.push({ accessorial_key: `${estado.toLowerCase()}-${a.fuente.fila}`, orden: i, estado, ...a, activo: true });
    });
  }
  return out;
}

export function seedAliases(): Row[] {
  const a = aliasesRaw as any;
  const out: Row[] = [];
  Object.entries(a.fl.terminales).forEach(([clave, valor], i) =>
    out.push({ alias_key: `fl-terminal-${clave}`, orden: i, estado: 'FL', tipo: 'terminal', clave, valor, activo: true }));
  Object.entries(a.tx.zip_a_ruta).forEach(([clave, valor], i) =>
    out.push({ alias_key: `tx-zip-${clave}`, orden: i, estado: 'TX', tipo: 'zip', clave, valor, activo: true }));
  if (a.fl._nota_terminales) {
    out.push({ alias_key: 'fl-nota-terminales', orden: 0, estado: 'FL', tipo: 'nota', clave: '_nota_terminales', valor: a.fl._nota_terminales, activo: true });
  }
  if (a._documentacion !== undefined) {
    // Documentación del archivo (no la usa el motor); se guarda para que la
    // reconstrucción sea idéntica byte a byte en contenido.
    out.push({ alias_key: 'documentacion', orden: 0, estado: 'ALL', tipo: 'documentacion', clave: '_documentacion', valor: a._documentacion, activo: true });
  }
  return out;
}

// Zonas: se derivan de las rutas (orden de primera aparición por estado).
export function seedZones(routes: Row[] = seedRoutes()): Row[] {
  const seen = new Map<string, Row>();
  for (const r of routes) {
    const key = `${String(r.estado).toLowerCase()}-${r.zona}`;
    if (!seen.has(key)) {
      const orden = [...seen.values()].filter((z) => z.estado === r.estado).length;
      seen.set(key, { zone_key: key, orden, estado: r.estado, zona: r.zona, activo: true });
    }
  }
  return [...seen.values()];
}

export function seedAll(): Record<CatalogEntity, Row[]> {
  const routes = seedRoutes();
  return { RateRoute: routes, RateAccessorial: seedAccessorials(), RateAlias: seedAliases(), RateZone: seedZones(routes) };
}

// ── 2. INVERSA (base → forma que consume el motor) ───────────────────────────

const byOrden = (a: Row, b: Row) => (a.orden ?? 0) - (b.orden ?? 0);
const activos = (rows: Row[]) => rows.filter((r) => r.activo !== false);

export function toRouteRecords(rows: Row[]): { fl: Row[]; tx: Row[] } {
  const map = (r: Row) => ({
    id: r.route_id, estado: r.estado, mercado: r.mercado, ciudad: r.ciudad, zona: r.zona,
    grupo: r.grupo ?? null, millas_ida: r.millas_ida, precios: r.precios, fuente: r.fuente,
    semantica_millas: r.semantica_millas,
  });
  const ok = activos(rows).sort(byOrden);
  return { fl: ok.filter((r) => r.estado === 'FL').map(map), tx: ok.filter((r) => r.estado === 'TX').map(map) };
}

export function toAccessorialRecords(rows: Row[]): { fl: Row[]; tx: Row[] } {
  const map = (r: Row) => ({ concepto: r.concepto, gatillo: r.gatillo ?? null, monto: r.monto, nota: r.nota ?? null, fuente: r.fuente });
  const ok = activos(rows).sort(byOrden);
  return { fl: ok.filter((r) => r.estado === 'FL').map(map), tx: ok.filter((r) => r.estado === 'TX').map(map) };
}

export function toAliasesFile(rows: Row[]): Row {
  const ok = activos(rows).sort(byOrden);
  const terminales: Record<string, string> = {};
  const zip: Record<string, string> = {};
  let nota: string | undefined;
  let doc: unknown;
  for (const r of ok) {
    if (r.tipo === 'terminal') terminales[r.clave] = r.valor;
    else if (r.tipo === 'zip') zip[r.clave] = r.valor;
    else if (r.tipo === 'nota') nota = r.valor;
    else if (r.tipo === 'documentacion') doc = r.valor;
  }
  return { ...(doc !== undefined ? { _documentacion: doc } : {}), fl: { terminales, ...(nota !== undefined ? { _nota_terminales: nota } : {}) }, tx: { zip_a_ruta: zip } };
}

// ── 3. UPSERT / DIFERENCIAS ──────────────────────────────────────────────────

// Igualdad estructural independiente del orden de llaves y de undefined vs
// ausente (Base44 puede devolver las llaves en otro orden).
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameValue(x, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as Row).filter((k) => (a as Row)[k] !== undefined);
    const kb = Object.keys(b as Row).filter((k) => (b as Row)[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => sameValue((a as Row)[k], (b as Row)[k]));
  }
  return false;
}

export function changedFields(entity: CatalogEntity, before: Row, after: Row): string[] {
  return BUSINESS_FIELDS[entity].filter((f) => !sameValue(before?.[f], after?.[f]));
}

export interface UpsertPlan {
  create: Row[];
  update: { id: string; key: string; campos: string[]; antes: Row; despues: Row }[];
  unchanged: number;
  duplicatedKeysInDb: string[];
}

// Clave → crear si no existe, actualizar si cambió algún campo de negocio,
// "igual" si no. Nunca borra: lo que está en la base y no viene en la carga
// se deja como está (desactivar es una acción explícita, no un efecto colateral).
export function planUpsert(entity: CatalogEntity, incoming: Row[], existing: Row[]): UpsertPlan {
  const key = KEY_FIELD[entity];
  const byKey = new Map<string, Row>();
  const dup: string[] = [];
  for (const e of existing) {
    if (byKey.has(e[key])) dup.push(e[key]);
    else byKey.set(e[key], e);
  }
  const plan: UpsertPlan = { create: [], update: [], unchanged: 0, duplicatedKeysInDb: dup };
  for (const row of incoming) {
    const cur = byKey.get(row[key]);
    if (!cur) { plan.create.push(row); continue; }
    const campos = changedFields(entity, cur, row);
    if (campos.length === 0) { plan.unchanged++; continue; }
    const antes: Row = {}; const despues: Row = {};
    for (const c of campos) { antes[c] = cur[c] ?? null; despues[c] = row[c] ?? null; }
    plan.update.push({ id: cur.id, key: row[key], campos, antes, despues });
  }
  return plan;
}

// Reporte de verificación: ¿lo que hay en la base reproduce EXACTAMENTE los
// JSON de hoy? Compara la forma final que consume el motor, no las filas.
export function verifyAgainstSeed(db: Record<CatalogEntity, Row[]>) {
  const r = toRouteRecords(db.RateRoute);
  const a = toAccessorialRecords(db.RateAccessorial);
  const al = toAliasesFile(db.RateAlias);
  const checks = {
    'routes.fl': sameValue(r.fl, routesFl),
    'routes.tx': sameValue(r.tx, routesTx),
    'accessorials.fl': sameValue(a.fl, accFl),
    'accessorials.tx': sameValue(a.tx, accTx),
    'aliases': sameValue(al, aliasesRaw),
  };
  const diffs: string[] = [];
  const cmp = (label: string, got: Row[], exp: any[], idOf: (x: any) => string) => {
    const m = new Map(got.map((x) => [idOf(x), x]));
    for (const e of exp) {
      const g = m.get(idOf(e));
      if (!g) diffs.push(`${label}: falta ${idOf(e)}`);
      else if (!sameValue(g, e)) diffs.push(`${label}: difiere ${idOf(e)}`);
    }
    if (got.length !== exp.length) diffs.push(`${label}: conteo ${got.length} vs ${exp.length}`);
  };
  cmp('routes.fl', r.fl, routesFl as any[], (x) => x.id);
  cmp('routes.tx', r.tx, routesTx as any[], (x) => x.id);
  cmp('accessorials.fl', a.fl, accFl as any[], (x) => `${x.fuente.fila}`);
  cmp('accessorials.tx', a.tx, accTx as any[], (x) => `${x.fuente.fila}`);
  return {
    ok: Object.values(checks).every(Boolean) && diffs.length === 0,
    checks,
    counts: {
      routes_fl: r.fl.length, routes_tx: r.tx.length,
      accessorials_fl: a.fl.length, accessorials_tx: a.tx.length,
      aliases_terminales: Object.keys(al.fl.terminales).length, aliases_zip: Object.keys(al.tx.zip_a_ruta).length,
      zonas: activos(db.RateZone).length,
    },
    diffs: diffs.slice(0, 50),
  };
}
