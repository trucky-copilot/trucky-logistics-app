// ─────────────────────────────────────────────────────────────────────────────
// F6-01 · Fase F — ejecución de un plan de tarifas contra la base.
// Separado de la función HTTP para poder probar el ciclo completo
// (migrar → editar → Excel → chat) con una base simulada en memoria.
// `db` = base44.asServiceRole.entities (o un doble con filter/bulkCreate/update/delete).
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogEntity } from './rateCatalog.ts';
import { signature, type Plan, type Db } from './rateEdits.ts';

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
  // ENTITIES empieza por RateZone: las zonas nuevas existen antes que sus rutas.
  for (const e of ENTITIES) {
    const items = plan.crear.filter((c) => c.entidad === e);
    for (let i = 0; i < items.length; i += CHUNK) {
      await db[e].bulkCreate(items.slice(i, i + CHUNK).map((c) => ({ ...c.despues, ...audit })));
    }
  }
  for (const u of plan.actualizar) await db[u.entidad].update(u.id, { ...u.despues, ...audit });
  for (const m of plan.metadatos) await db[m.entidad].update(m.id, { ...m.despues, ...audit });
  for (const d of plan.eliminar) await db[d.entidad].delete(d.id);
}
