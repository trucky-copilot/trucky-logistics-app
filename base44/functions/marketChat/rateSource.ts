// ─────────────────────────────────────────────────────────────────────────────
// F6-01 · Fase C — de dónde lee el chat las tarifas.
//
// Lee RateRoute / RateAccessorial / RateAlias de la base (service role, porque
// las tablas solo las leen administradores), las convierte a la MISMA forma de
// los JSON (shared/rateCatalog.ts) y se las entrega a rateTable/nameResolution.
// La lógica del cotizador no se toca.
//
// Reglas de seguridad:
//   - Base vacía (migración aún no corrida) → se usan los JSON del repo.
//   - Error de lectura o datos inválidos → se conserva lo último bueno
//     (o los JSON si nunca cargó). Nunca se cotiza con datos a medias.
//   - Caché en memoria de 60 s: un cambio en la pantalla se ve en ≤ 1 min.
// ─────────────────────────────────────────────────────────────────────────────

import { toRouteRecords, toAccessorialRecords, toAliasesFile } from '../../shared/rateCatalog.ts';
import { setRateTables, validateRateTables, type RateTablesInput } from './rateTable.ts';
import { setAliases, type AliasesFile } from './nameResolution.ts';

export const RATE_CACHE_TTL_MS = 60 * 1000;
const PAGE = 500;

let loadedAt = 0;
let inflight: Promise<RateLoadResult> | null = null;

export interface RateLoadResult {
  source: 'db' | 'json' | 'cache';
  reason?: string;
}

async function readAll(db: any, entity: string): Promise<any[]> {
  const out: any[] = [];
  for (let skip = 0; ; skip += PAGE) {
    const page = await db[entity].filter({}, 'orden', PAGE, skip);
    const rows = Array.isArray(page) ? page : [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

// Puro (testeable): filas de la base → datos listos o motivo de rechazo.
export function buildFromRows(rows: { routes: any[]; accessorials: any[]; aliases: any[] }):
  { ok: true; tables: RateTablesInput; aliases: AliasesFile; zipSinRuta: string[] } | { ok: false; reason: string } {
  if (rows.routes.length === 0) return { ok: false, reason: 'base-vacia' };
  // La migración escribe zonas → rutas → accesoriales → alias. Si alguna tabla
  // quedó vacía, la migración no terminó: no se mezcla base con archivos.
  if (rows.accessorials.length === 0 || rows.aliases.length === 0) return { ok: false, reason: 'migracion-incompleta' };
  const r = toRouteRecords(rows.routes);
  const a = toAccessorialRecords(rows.accessorials);
  const tables = { routesFl: r.fl, routesTx: r.tx, accessorialsFl: a.fl, accessorialsTx: a.tx } as unknown as RateTablesInput;
  const errs = validateRateTables(tables);
  if (errs.length) return { ok: false, reason: `invalido: ${errs.slice(0, 3).join('; ')}` };
  const aliases = toAliasesFile(rows.aliases) as AliasesFile;
  // Un ZIP que apunta a una ruta inexistente NO bloquea la carga: hoy ya pasa
  // en los JSON (48 de 50 ZIP apuntan a ids de una versión vieja de la tabla
  // TX) y resolveTxZip simplemente no lo resuelve. Se informa, no se corrige
  // aquí, para no cambiar respuestas del chat.
  const txIds = new Set(r.tx.map((x: any) => x.id));
  const zipSinRuta = Object.entries(aliases.tx.zip_a_ruta).filter(([, id]) => !txIds.has(id)).map(([z]) => z);
  return { ok: true, tables, aliases, zipSinRuta };
}

export function resetRateSourceCache(): void {
  loadedAt = 0;
  inflight = null;
}

export async function ensureRatesFromDb(base44: any, now = Date.now()): Promise<RateLoadResult> {
  if (loadedAt && now - loadedAt < RATE_CACHE_TTL_MS) return { source: 'cache' };
  if (inflight) return inflight;
  inflight = (async (): Promise<RateLoadResult> => {
    try {
      const db = base44.asServiceRole.entities;
      const [routes, accessorials, aliases] = await Promise.all([
        readAll(db, 'RateRoute'), readAll(db, 'RateAccessorial'), readAll(db, 'RateAlias'),
      ]);
      const built = buildFromRows({ routes, accessorials, aliases });
      loadedAt = now; // aunque se rechace, no reintentar en cada mensaje
      if (!built.ok) {
        console.warn(`[rateSource] se mantienen las tarifas actuales: ${built.reason}`);
        return { source: 'json', reason: built.reason };
      }
      setRateTables(built.tables); // valida otra vez y cambia todo junto
      setAliases(built.aliases);
      return { source: 'db' };
    } catch (err) {
      loadedAt = now;
      console.warn('[rateSource] error leyendo tarifas de la base; se mantienen las actuales', err);
      return { source: 'json', reason: 'error-lectura' };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
