// ─────────────────────────────────────────────────────────────────────────────
// F6-01 · Fase E — reglas de escritura de tarifas (dominio puro, sin red).
//
// Toda escritura (pantalla o Excel) pasa por aquí ANTES de tocar la base:
//   1. Validar cada cambio (precios > 0, piso ≤ objetivo, zona existente, ...).
//   2. Armar un PLAN: crear / actualizar / eliminar, con antes → después.
//   3. La función del servidor muestra el plan (preview) o lo ejecuta (apply).
// Si hay un solo error, el plan no se aplica (todo o nada a nivel de validación).
//
// UPSERT por identidad de la ruta: estado + mercado + ciudad + zona. Así un
// Excel nuevo con filas corridas actualiza el MISMO registro (no duplica) y
// lo que ya no viene se ELIMINA (con confirmación), no se acumula inactivo.
// ─────────────────────────────────────────────────────────────────────────────

import { KEY_FIELD, sameValue, type CatalogEntity } from './rateCatalog.ts';

type Row = Record<string, any>;
export type Db = Record<CatalogEntity, Row[]>;

export interface PlanItem { entidad: CatalogEntity; key: string; id?: string; campos?: string[]; antes?: Row | null; despues?: Row | null; resumen?: string }
export interface Plan {
  crear: PlanItem[];
  actualizar: PlanItem[];
  eliminar: PlanItem[];
  metadatos: PlanItem[];   // solo cambia origen/orden del Excel: se guarda sin ensuciar el historial
  iguales: number;
  errores: { key?: string; mensaje: string }[];
  avisos: string[];
}

export const emptyPlan = (): Plan => ({ crear: [], actualizar: [], eliminar: [], metadatos: [], iguales: 0, errores: [], avisos: [] });

const TAMANOS = ['20', '40', '45', '20_heavy'];
const ESTADOS = ['FL', 'TX'];
export const HISTORY_RETENTION_DAYS = 365;

export const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
export const slug = (...p: unknown[]) => p.filter((x) => x != null && x !== '').map(norm).join('-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const routeIdentity = (r: Row) => [r.estado, norm(r.mercado), norm(r.ciudad), norm(r.zona)].join('|');

const resumenRuta = (r: Row) =>
  `${r.ciudad} · ${r.mercado} · ${r.zona} · ${r.millas_ida} mi · ` +
  (r.precios || []).map((p: Row) => `${p.tamano}: $${p.objetivo}${p.piso_tabla != null ? ` (piso $${p.piso_tabla})` : ''}`).join(' / ');

// ── Validaciones ─────────────────────────────────────────────────────────────

export function validateRoute(r: Row, zonasActivas: Set<string>): string[] {
  const e: string[] = [];
  if (!ESTADOS.includes(r.estado)) e.push('estado debe ser FL o TX');
  if (!String(r.ciudad ?? '').trim()) e.push('falta la ciudad');
  if (!String(r.mercado ?? '').trim()) e.push('falta el mercado');
  if (!String(r.zona ?? '').trim()) e.push('falta la zona');
  else if (!zonasActivas.has(`${r.estado}|${r.zona}`)) e.push(`la zona "${r.zona}" no existe o está inactiva en ${r.estado}`);
  if (typeof r.millas_ida !== 'number' || !isFinite(r.millas_ida) || r.millas_ida < 0 || r.millas_ida > 3000) e.push('millas de ida inválidas (0 a 3000)');
  if (!Array.isArray(r.precios) || r.precios.length === 0) e.push('debe tener al menos un precio');
  const vistos = new Set<string>();
  for (const p of r.precios || []) {
    if (!TAMANOS.includes(p?.tamano)) { e.push(`tamaño inválido "${p?.tamano}"`); continue; }
    if (vistos.has(p.tamano)) e.push(`tamaño ${p.tamano} repetido`);
    vistos.add(p.tamano);
    if (typeof p.objetivo !== 'number' || !isFinite(p.objetivo) || p.objetivo <= 0 || p.objetivo > 50000) e.push(`precio ${p.tamano} inválido`);
    if (p.piso_tabla != null) {
      if (typeof p.piso_tabla !== 'number' || !isFinite(p.piso_tabla) || p.piso_tabla <= 0) e.push(`piso ${p.tamano} inválido`);
      else if (p.piso_tabla > p.objetivo) e.push(`piso ${p.tamano} mayor que el objetivo`);
    }
  }
  return e;
}

function validateAccessorial(a: Row): string[] {
  const e: string[] = [];
  if (!ESTADOS.includes(a.estado)) e.push('estado debe ser FL o TX');
  if (!String(a.concepto ?? '').trim()) e.push('falta el concepto');
  if (!String(a.monto ?? '').trim()) e.push('falta el monto');
  return e;
}

function validateAlias(a: Row, txRouteIds: Set<string>): string[] {
  const e: string[] = [];
  if (a.tipo === 'terminal') {
    if (!String(a.clave ?? '').trim()) e.push('falta el nombre de la terminal');
    if (!['MIA', 'PEV'].includes(a.valor)) e.push('el puerto debe ser MIA o PEV');
  } else if (a.tipo === 'zip') {
    if (!/^\d{5}$/.test(String(a.clave ?? ''))) e.push('el ZIP debe tener 5 dígitos');
    if (!txRouteIds.has(a.valor)) e.push('la ruta elegida no existe');
  } else e.push('tipo de alias no editable');
  return e;
}

// ── Contexto común ───────────────────────────────────────────────────────────

function ctx(db: Db) {
  const zonasActivas = new Set(db.RateZone.filter((z) => z.activo !== false).map((z) => `${z.estado}|${z.zona}`));
  const txRouteIds = new Set(db.RateRoute.filter((r) => r.estado === 'TX').map((r) => r.route_id));
  const maxOrden = (rows: Row[], estado?: string) => rows.filter((r) => !estado || r.estado === estado).reduce((m, r) => Math.max(m, r.orden ?? 0), -1);
  return { zonasActivas, txRouteIds, maxOrden };
}

function uniqueKey(base: string, used: Set<string>) {
  let k = base; let i = 2;
  while (used.has(k)) k = `${base}-${i++}`;
  used.add(k);
  return k;
}

// Campos que la pantalla puede tocar en cada tabla (lo demás lo fija el servidor).
const EDITABLE: Record<CatalogEntity, string[]> = {
  RateRoute: ['ciudad', 'mercado', 'zona', 'grupo', 'millas_ida', 'precios', 'activo', 'notas'],
  RateAccessorial: ['concepto', 'gatillo', 'monto', 'nota', 'activo'],
  RateAlias: ['valor', 'activo'],
  RateZone: ['descripcion', 'activo'],
};

function cleanRoutePrices(precios: unknown): Row[] {
  if (!Array.isArray(precios)) return [];
  return precios.map((p: Row) => ({
    tamano: String(p?.tamano ?? ''),
    objetivo: p?.objetivo == null || p?.objetivo === '' ? NaN : Number(p.objetivo),
    piso_tabla: p?.piso_tabla == null || p?.piso_tabla === '' ? null : Number(p.piso_tabla),
    derivado: p?.derivado === true,
  }));
}

function pick(entity: CatalogEntity, data: Row): Row {
  const out: Row = {};
  for (const k of EDITABLE[entity]) if (k in (data || {})) out[k] = data[k];
  if ('precios' in out) out.precios = cleanRoutePrices(out.precios);
  if ('millas_ida' in out) out.millas_ida = out.millas_ida === '' || out.millas_ida == null ? NaN : Number(out.millas_ida);
  if ('grupo' in out) out.grupo = out.grupo === '' || out.grupo == null ? null : String(out.grupo);
  for (const k of ['ciudad', 'mercado', 'concepto', 'monto']) if (typeof out[k] === 'string') out[k] = out[k].trim();
  if ('activo' in out) out.activo = out.activo !== false;
  return out;
}

// ── Cambios manuales desde la pantalla ───────────────────────────────────────
// change = { key: clave existente | null (nuevo), data: {...}, eliminar?: true }

export function planManual(entity: CatalogEntity, changes: Row[], db: Db): Plan {
  const plan = emptyPlan();
  if (!KEY_FIELD[entity]) { plan.errores.push({ mensaje: `tabla desconocida ${entity}` }); return plan; }
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 500) { plan.errores.push({ mensaje: 'lista de cambios vacía o demasiado grande' }); return plan; }
  const keyF = KEY_FIELD[entity];
  const rows = db[entity];
  const byKey = new Map(rows.map((r) => [r[keyF], r]));
  const used = new Set(rows.map((r) => r[keyF]));
  const c = ctx(db);
  let nextOrden = c.maxOrden(rows) + 1;

  for (const ch of changes) {
    const cur = ch?.key ? byKey.get(ch.key) : null;
    if (ch?.key && !cur) { plan.errores.push({ key: ch.key, mensaje: 'el registro ya no existe (recarga la pantalla)' }); continue; }

    // Eliminar
    if (ch?.eliminar) {
      if (!cur) { plan.errores.push({ mensaje: 'no se puede eliminar un registro nuevo' }); continue; }
      const err = deleteBlockers(entity, cur, db);
      if (err) { plan.errores.push({ key: ch.key, mensaje: err }); continue; }
      plan.eliminar.push({ entidad: entity, key: ch.key, id: cur.id, antes: cur, resumen: entity === 'RateRoute' ? resumenRuta(cur) : undefined });
      if (entity === 'RateRoute') plan.avisos.push(...zipAvisos([cur], db));
      continue;
    }

    const data = pick(entity, ch?.data || {});
    let next: Row;
    if (cur) {
      next = { ...cur, ...data };
    } else {
      const estado = ch?.data?.estado;
      if (!ESTADOS.includes(estado)) { plan.errores.push({ mensaje: 'estado debe ser FL o TX' }); continue; }
      next = { estado, activo: true, ...data, orden: nextOrden++ };
      if (entity === 'RateRoute') {
        const ref = db.RateRoute.find((r) => r.estado === estado);
        next.semantica_millas = ref?.semantica_millas ?? { tipo_millas: 'ida', precio_incluye_regreso: estado === 'FL', nota: 'Ruta creada manualmente.' };
        next.fuente = { archivo: 'manual', sha: '', fila: 0 };
        next.route_id = uniqueKey(slug(estado, next.zona, next.ciudad, next.mercado, 'manual'), used);
      } else if (entity === 'RateAccessorial') {
        next.fuente = { archivo: 'manual', fila: 0 };
        next.accessorial_key = uniqueKey(slug(estado, 'manual', next.concepto), used);
      } else if (entity === 'RateAlias') {
        next.tipo = ch.data.tipo;
        next.clave = norm(ch.data.clave);
        next.alias_key = next.tipo === 'zip' ? `tx-zip-${next.clave}` : `fl-terminal-${next.clave}`;
        if (used.has(next.alias_key)) { plan.errores.push({ key: next.alias_key, mensaje: 'ese alias ya existe' }); continue; }
        used.add(next.alias_key);
      } else if (entity === 'RateZone') {
        next.zona = String(ch.data.zona ?? '').trim().toUpperCase();
        if (!next.zona) { plan.errores.push({ mensaje: 'falta el nombre de la zona' }); continue; }
        next.zone_key = `${estado.toLowerCase()}-${next.zona}`;
        if (used.has(next.zone_key)) { plan.errores.push({ key: next.zone_key, mensaje: 'esa zona ya existe' }); continue; }
        used.add(next.zone_key);
      }
    }

    const errs = entity === 'RateRoute' ? validateRoute(next, c.zonasActivas)
      : entity === 'RateAccessorial' ? validateAccessorial(next)
      : entity === 'RateAlias' ? validateAlias(next, c.txRouteIds) : [];
    if (entity === 'RateRoute') {
      const dup = db.RateRoute.find((r) => r.route_id !== next.route_id && routeIdentity(r) === routeIdentity(next));
      if (dup && (!cur || routeIdentity(cur) !== routeIdentity(next))) errs.push(`ya existe otra ruta ${next.ciudad} · ${next.mercado} · ${next.zona}`);
    }
    if (entity === 'RateZone' && cur && data.activo === false) {
      const enUso = db.RateRoute.filter((r) => r.estado === cur.estado && r.zona === cur.zona && r.activo !== false).length;
      if (enUso) errs.push(`hay ${enUso} rutas activas en esta zona; muévelas antes de desactivarla`);
    }
    if (errs.length) { plan.errores.push(...errs.map((m) => ({ key: next[keyF] ?? ch?.key ?? 'nuevo', mensaje: m }))); continue; }

    if (!cur) {
      plan.crear.push({ entidad: entity, key: next[keyF], despues: next, resumen: entity === 'RateRoute' ? resumenRuta(next) : undefined });
      continue;
    }
    const campos = EDITABLE[entity].filter((f) => f in data && !sameValue(cur[f], next[f]));
    if (!campos.length) { plan.iguales++; continue; }
    const antes: Row = {}; const despues: Row = {};
    for (const f of campos) { antes[f] = cur[f] ?? null; despues[f] = next[f] ?? null; }
    plan.actualizar.push({ entidad: entity, key: ch.key, id: cur.id, campos, antes, despues });
  }
  return plan;
}

function deleteBlockers(entity: CatalogEntity, cur: Row, db: Db): string | null {
  if (entity === 'RateZone') {
    const n = db.RateRoute.filter((r) => r.estado === cur.estado && r.zona === cur.zona).length;
    return n ? `la zona tiene ${n} rutas; muévelas o elimínalas primero` : null;
  }
  if (entity === 'RateAlias' && cur.tipo !== 'terminal' && cur.tipo !== 'zip') return 'este registro es documentación interna, no se elimina';
  return null;
}

function zipAvisos(eliminadas: Row[], db: Db): string[] {
  const ids = new Set(eliminadas.map((r) => r.route_id));
  const zips = db.RateAlias.filter((a) => a.tipo === 'zip' && ids.has(a.valor)).map((a) => a.clave);
  return zips.length ? [`Los ZIP ${zips.join(', ')} apuntan a rutas que se eliminan: el chat dejará de reconocerlos hasta reasignarlos.`] : [];
}

// ── Carga de Excel (UPSERT por identidad + eliminar faltantes) ───────────────
// `incoming` = salida del conversor (forma de los JSON: id, precios, fuente...).

const ROUTE_TARIFA = ['mercado', 'ciudad', 'zona', 'grupo', 'millas_ida', 'precios', 'activo'];

export function planExcel(estado: 'FL' | 'TX', incoming: { routes: Row[]; accessorials: Row[] }, db: Db, eliminarFaltantes: boolean): Plan {
  const plan = emptyPlan();
  if (!ESTADOS.includes(estado)) { plan.errores.push({ mensaje: 'estado debe ser FL o TX' }); return plan; }
  const rutas = incoming.routes.filter((r) => r.estado === estado);
  if (rutas.length === 0) { plan.errores.push({ mensaje: `el archivo no trae rutas de ${estado}` }); return plan; }
  if (rutas.length !== incoming.routes.length) plan.errores.push({ mensaje: `el archivo trae rutas de otro estado; elegiste ${estado}` });

  // Zonas nuevas que trae el archivo se crean solas.
  const zonas = new Set(db.RateZone.map((z) => `${z.estado}|${z.zona}`));
  const zonasActivas = new Set(db.RateZone.filter((z) => z.activo !== false).map((z) => `${z.estado}|${z.zona}`));
  let zOrden = db.RateZone.filter((z) => z.estado === estado).reduce((m, z) => Math.max(m, z.orden ?? 0), -1) + 1;
  for (const r of rutas) {
    const k = `${estado}|${r.zona}`;
    if (!zonas.has(k)) {
      zonas.add(k); zonasActivas.add(k);
      plan.crear.push({ entidad: 'RateZone', key: `${estado.toLowerCase()}-${r.zona}`, despues: { zone_key: `${estado.toLowerCase()}-${r.zona}`, estado, zona: r.zona, orden: zOrden++, activo: true }, resumen: `Zona nueva ${r.zona}` });
    }
  }

  // Emparejar: misma identidad (en orden si hay repetidas, ej. lake worth beach); si no, mismo id.
  const existentes = db.RateRoute.filter((r) => r.estado === estado).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const porIdentidad = new Map<string, Row[]>();
  for (const e of existentes) { const k = routeIdentity(e); porIdentidad.set(k, [...(porIdentidad.get(k) || []), e]); }
  const usados = new Set<string>();
  const usedKeys = new Set(db.RateRoute.map((r) => r.route_id));
  const base = existentes.length ? Math.min(...existentes.map((r) => r.orden ?? 0)) : db.RateRoute.reduce((m, r) => Math.max(m, (r.orden ?? 0) + 1), 0);

  rutas.forEach((inc, i) => {
    const { id: incId, ...rest } = inc;
    const next: Row = { ...rest, estado, orden: base + i, activo: true };
    const errs = validateRoute(next, zonasActivas);
    if (errs.length) { plan.errores.push(...errs.map((m) => ({ key: `fila ${inc.fuente?.fila ?? '?'} (${inc.ciudad})`, mensaje: m }))); return; }

    let cur = (porIdentidad.get(routeIdentity(next)) || []).find((e) => !usados.has(e.id));
    if (!cur) cur = existentes.find((e) => !usados.has(e.id) && e.route_id === incId);
    if (!cur) {
      next.route_id = uniqueKey(incId || slug(estado, next.zona, next.ciudad, next.mercado), usedKeys);
      plan.crear.push({ entidad: 'RateRoute', key: next.route_id, despues: next, resumen: resumenRuta(next) });
      return;
    }
    usados.add(cur.id);
    next.route_id = cur.route_id; // la clave se conserva: el chat y los ZIP siguen apuntando bien
    const campos = ROUTE_TARIFA.filter((f) => !sameValue(cur[f], next[f]));
    const meta = ['orden', 'fuente', 'semantica_millas'].filter((f) => !sameValue(cur[f], next[f]));
    if (campos.length) {
      const antes: Row = {}; const despues: Row = {};
      for (const f of [...campos, ...meta]) { antes[f] = cur[f] ?? null; despues[f] = next[f] ?? null; }
      plan.actualizar.push({ entidad: 'RateRoute', key: cur.route_id, id: cur.id, campos, antes, despues });
    } else if (meta.length) {
      const despues: Row = {}; for (const f of meta) despues[f] = next[f];
      plan.metadatos.push({ entidad: 'RateRoute', key: cur.route_id, id: cur.id, campos: meta, despues });
      plan.iguales++;
    } else plan.iguales++;
  });

  const faltantes = existentes.filter((e) => !usados.has(e.id));
  if (faltantes.length) {
    if (eliminarFaltantes) {
      for (const f of faltantes) plan.eliminar.push({ entidad: 'RateRoute', key: f.route_id, id: f.id, antes: f, resumen: resumenRuta(f) });
      plan.avisos.push(...zipAvisos(faltantes, db));
    } else {
      plan.avisos.push(`${faltantes.length} rutas de ${estado} no vienen en el archivo y se mantendrán. Marca "Eliminar las que no vienen" si ya no se usan.`);
    }
  }

  // Accesoriales: por concepto (sin importar mayúsculas/tildes).
  // Un mismo concepto puede repetirse por tramos (ej. Extra Stop 0–5 / 5–50 / +50 mi):
  // se emparejan en el orden en que aparecen.
  const accEx = db.RateAccessorial.filter((a) => a.estado === estado).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const accBy = new Map<string, Row[]>();
  for (const a of accEx) accBy.set(norm(a.concepto), [...(accBy.get(norm(a.concepto)) || []), a]);
  const accUsados = new Set<string>();
  const accKeys = new Set(db.RateAccessorial.map((a) => a.accessorial_key));
  (incoming.accessorials || []).forEach((a, i) => {
    const next: Row = { ...a, estado, orden: i, activo: true };
    const errs = validateAccessorial(next);
    if (errs.length) { plan.errores.push(...errs.map((m) => ({ key: `accesorial ${a.concepto ?? i}`, mensaje: m }))); return; }
    const cur = (accBy.get(norm(a.concepto)) || []).find((x) => !accUsados.has(x.id));
    if (!cur) {
      next.accessorial_key = uniqueKey(`${estado.toLowerCase()}-${a.fuente?.fila ?? i}`, accKeys);
      plan.crear.push({ entidad: 'RateAccessorial', key: next.accessorial_key, despues: next, resumen: `${a.concepto}: ${a.monto}` });
      return;
    }
    accUsados.add(cur.id);
    next.accessorial_key = cur.accessorial_key;
    const campos = ['concepto', 'gatillo', 'monto', 'nota', 'activo'].filter((f) => !sameValue(cur[f], next[f]));
    const meta = ['orden', 'fuente'].filter((f) => !sameValue(cur[f], next[f]));
    if (campos.length) {
      const antes: Row = {}; const despues: Row = {};
      for (const f of [...campos, ...meta]) { antes[f] = cur[f] ?? null; despues[f] = next[f] ?? null; }
      plan.actualizar.push({ entidad: 'RateAccessorial', key: cur.accessorial_key, id: cur.id, campos, antes, despues });
    } else {
      if (meta.length) { const d: Row = {}; for (const f of meta) d[f] = next[f]; plan.metadatos.push({ entidad: 'RateAccessorial', key: cur.accessorial_key, id: cur.id, campos: meta, despues: d }); }
      plan.iguales++;
    }
  });
  if (eliminarFaltantes && (incoming.accessorials || []).length) {
    for (const a of accEx) if (!accUsados.has(a.id)) plan.eliminar.push({ entidad: 'RateAccessorial', key: a.accessorial_key, id: a.id, antes: a, resumen: `${a.concepto}: ${a.monto}` });
  }
  return plan;
}

// Firma de los datos sobre los que se armó la vista previa. Si al confirmar
// alguien más cambió algo, la firma no coincide y se pide revisar de nuevo.
export function signature(rows: Row[]): string {
  const s = rows.map((r) => `${r.id}:${r.updated_date ?? r.created_date ?? ''}`).sort().join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${rows.length}-${(h >>> 0).toString(16)}`;
}

// Historial a eliminar por antigüedad (más de HISTORY_RETENTION_DAYS días).
export function expiredHistory(rows: Row[], now = Date.now(), days = HISTORY_RETENTION_DAYS): Row[] {
  const limite = now - days * 86400000;
  return rows.filter((r) => { const t = Date.parse(r.created_date ?? ''); return isFinite(t) && t < limite; });
}
