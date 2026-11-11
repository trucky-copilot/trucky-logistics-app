// ─────────────────────────────────────────────────────────────────────────────
// F6-01 · Fase F — ejecución de un plan de tarifas contra la base.
// Separado de la función HTTP para poder probar el ciclo completo
// (migrar → editar → Excel → chat) con una base simulada en memoria.
// `db` = base44.asServiceRole.entities (o un doble con filter/bulkCreate/update/delete).
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogEntity } from './rateCatalog.ts';
import { signature, expiredHistory, type Plan, type Db } from './rateEdits.ts';

export const ENTITIES: CatalogEntity[] = ['RateZone', 'RateRoute', 'RateAccessorial', 'RateAlias'];
const PAGE = 500;
const CHUNK = 100;

export async function readAll(db: any, entity: string, sort = 'orden'): Promise<any[]> {
  const out: any[] = [];
  for (let skip = 0; ; skip += PAGE) {
    const page = await db[entity].filter({}, sort, PAGE, skip);
    const rows = Array.isArray(page) ? page : [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function readDb(db: any): Promise<Db> {
  const out = {} as Db;
  for (const e of ENTITIES) out[e] = await readAll(db, e);
  return out;
}

export const firmaDe = (d: Db) => signature(ENTITIES.flatMap((e) => d[e].map((r) => ({ ...r, id: `${e}:${r.id}` }))));

export function strip(r: Record<string, any> | null | undefined) {
  if (!r) return r;
  const { id: _i, created_date: _c, updated_date: _u, created_by: _b, ...rest } = r;
  return rest;
}

export async function execute(db: any, plan: Plan, email: string, origen: 'manual' | 'excel') {
  const audit = { actualizado_por: email, origen };
  const lote = `${origen}-${new Date().toISOString()}`;
  let logs: any[] = [];
  // El historial se escribe al terminar cada bloque, para que un corte a mitad
  // de camino no deje cambios aplicados sin registro.
  const flush = async () => {
    for (let i = 0; i < logs.length; i += CHUNK) await db.RateChangeLog.bulkCreate(logs.slice(i, i + CHUNK));
    logs = [];
  };

  // ENTITIES empieza por RateZone: las zonas nuevas existen antes que sus rutas.
  for (const e of ENTITIES) {
    const items = plan.crear.filter((c) => c.entidad === e);
    for (let i = 0; i < items.length; i += CHUNK) {
      await db[e].bulkCreate(items.slice(i, i + CHUNK).map((c) => ({ ...c.despues, ...audit })));
    }
  }
  for (const c of plan.crear) logs.push({ entidad: c.entidad, registro_key: c.key, accion: 'crear', antes: null, despues: c.despues, campos: [], usuario_email: email, origen, lote_id: lote });
  await flush();

  for (const u of plan.actualizar) {
    await db[u.entidad].update(u.id, { ...u.despues, ...audit });
    logs.push({ entidad: u.entidad, registro_key: u.key, accion: 'actualizar', antes: u.antes, despues: u.despues, campos: u.campos, usuario_email: email, origen, lote_id: lote });
  }
  await flush();
  for (const m of plan.metadatos) await db[m.entidad].update(m.id, { ...m.despues, ...audit });

  for (const d of plan.eliminar) {
    await db[d.entidad].delete(d.id);
    logs.push({ entidad: d.entidad, registro_key: d.key, accion: 'eliminar', antes: strip(d.antes), despues: null, campos: [], usuario_email: email, origen, lote_id: lote });
  }

  await flush();
  return lote;
}

// Limpieza del historial: lo más antiguo primero, máximo 500 por ejecución.
export async function purgeHistory(db: any): Promise<number> {
  try {
    const oldest = await db.RateChangeLog.filter({}, 'created_date', PAGE, 0);
    const expired = expiredHistory(Array.isArray(oldest) ? oldest : []);
    for (const r of expired) await db.RateChangeLog.delete(r.id);
    return expired.length;
  } catch (err) {
    console.warn('[adminSaveRates] no se pudo limpiar el historial', err);
    return 0;
  }
}
