// ─────────────────────────────────────────────────────────────────────────────
// TABLA DE RUTAS — dominio puro (sin llamadas de red, sin IA), reglas-v3-multiestado
// Fase 1 (conversión y carga).
//
// Carga los JSON versionados generados OFFLINE por shared/rateExcel.ts
// (ese script NUNCA se importa desde acá ni desde entry.ts/rateEngine.ts — no
// hay importador de Excel en tiempo de ejecución, fuera de alcance de este SDD).
//
// REGLA: acá no entra nada que haga red ni invoque al LLM. Leer archivos del
// propio módulo (JSON versionado en el repo) SÍ está permitido —es dato
// estático desplegado junto al código, no I/O externo— y es lo que permite
// cubrir este módulo con `deno test --allow-read`.
// ─────────────────────────────────────────────────────────────────────────────

export type Estado = 'FL' | 'TX';
export type Tamano = '20' | '40' | '45' | '20_heavy';

export interface RoutePriceEntry {
  tamano: Tamano;
  objetivo: number;
  piso_tabla: number | null;
  derivado: boolean;
}

export interface RouteFuente {
  archivo: string;
  sha: string;
  fila: number;
  nota_original?: string;
}

export interface SemanticaMillas {
  tipo_millas: 'ida' | 'ida_y_vuelta';
  precio_incluye_regreso: boolean;
  nota: string;
}

export interface RouteRecord {
  id: string;
  estado: Estado;
  mercado: string;
  ciudad: string;
  zona: string;
  grupo: string | number | null;
  millas_ida: number;
  precios: RoutePriceEntry[];
  fuente: RouteFuente;
  semantica_millas: SemanticaMillas;
}

export interface AccessorialRecord {
  concepto: string;
  gatillo: string | null;
  monto: string;
  nota: string | null;
  fuente: { archivo: string; fila: number };
  isCustom?: boolean;
}

export interface RouteCounts {
  fl: number;
  tx: number;
  total: number;
}

export interface UnmatchedRouteEntry {
  ciudad: string;
  estado: Estado | string;
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CARGA — import estático de los JSON versionados. Se resuelve una sola vez al
// cargar el módulo (los datos no cambian en runtime: son un artefacto versionado
// en el repo, no una base de datos).
// ─────────────────────────────────────────────────────────────────────────────

import routesFlRaw from '../../shared/rateData/routes.fl.json' with { type: 'json' };
import routesTxRaw from '../../shared/rateData/routes.tx.json' with { type: 'json' };
import accessorialsFlRaw from '../../shared/rateData/accessorials.fl.json' with { type: 'json' };
import accessorialsTxRaw from '../../shared/rateData/accessorials.tx.json' with { type: 'json' };

const BUNDLED_ROUTES_FL = routesFlRaw as unknown as RouteRecord[];
const BUNDLED_ROUTES_TX = routesTxRaw as unknown as RouteRecord[];
const BUNDLED_ACCESSORIALS_FL = accessorialsFlRaw as unknown as AccessorialRecord[];
const BUNDLED_ACCESSORIALS_TX = accessorialsTxRaw as unknown as AccessorialRecord[];

// F6-01 Fase C: los datos activos son variables. Arrancan con los JSON del repo
// (respaldo) y rateSource.ts los reemplaza por lo que hay en la base. Las
// funciones de búsqueda de abajo NO cambian: solo cambia de dónde vienen los datos.
let ROUTES_FL = BUNDLED_ROUTES_FL;
let ROUTES_TX = BUNDLED_ROUTES_TX;
let ACCESSORIALS_FL = BUNDLED_ACCESSORIALS_FL;
let ACCESSORIALS_TX = BUNDLED_ACCESSORIALS_TX;
let RATE_SOURCE: 'json' | 'db' = 'json';

// Guardarraíl de integridad (criterio de éxito 1): si el JSON versionado se
// edita a mano y el conteo se corrompe, el módulo falla al cargar en vez de
// servir una tabla incompleta en silencio.
const EXPECTED_FL_COUNT = 209;
const EXPECTED_TX_COUNT = 63;

if (BUNDLED_ROUTES_FL.length !== EXPECTED_FL_COUNT) {
  throw new Error(`rateTable: se esperaban ${EXPECTED_FL_COUNT} rutas FL, el JSON versionado trae ${BUNDLED_ROUTES_FL.length}`);
}
if (BUNDLED_ROUTES_TX.length !== EXPECTED_TX_COUNT) {
  throw new Error(`rateTable: se esperaban ${EXPECTED_TX_COUNT} rutas TX, el JSON versionado trae ${BUNDLED_ROUTES_TX.length}`);
}

export interface RateTablesInput {
  routesFl: RouteRecord[];
  routesTx: RouteRecord[];
  accessorialsFl: AccessorialRecord[];
  accessorialsTx: AccessorialRecord[];
}

const TAMANOS = new Set(['20', '40', '45', '20_heavy']);

// Valida la forma mínima que el motor necesita. Si algo no cuadra, se lanza
// error y quien llama se queda con los datos anteriores (nunca a medias).
export function validateRateTables(d: RateTablesInput): string[] {
  const errs: string[] = [];
  const checkRoutes = (list: RouteRecord[], estado: Estado) => {
    if (!Array.isArray(list) || list.length === 0) { errs.push(`sin rutas ${estado}`); return; }
    for (const r of list) {
      if (!r?.id || r.estado !== estado || !r.ciudad) { errs.push(`ruta inválida ${r?.id ?? '?'}`); continue; }
      if (typeof r.millas_ida !== 'number' || !isFinite(r.millas_ida) || r.millas_ida < 0) errs.push(`millas inválidas ${r.id}`);
      if (!Array.isArray(r.precios) || r.precios.length === 0) { errs.push(`sin precios ${r.id}`); continue; }
      for (const p of r.precios) {
        if (!TAMANOS.has(p?.tamano) || typeof p.objetivo !== 'number' || !(p.objetivo > 0)) errs.push(`precio inválido ${r.id}`);
        if (p.piso_tabla != null && (typeof p.piso_tabla !== 'number' || !(p.piso_tabla > 0))) errs.push(`piso inválido ${r.id}`);
      }
      if (!r.semantica_millas || typeof r.semantica_millas.precio_incluye_regreso !== 'boolean') errs.push(`semantica_millas inválida ${r.id}`);
    }
  };
  checkRoutes(d.routesFl, 'FL');
  checkRoutes(d.routesTx, 'TX');
  for (const [k, list] of [['FL', d.accessorialsFl], ['TX', d.accessorialsTx]] as const) {
    if (!Array.isArray(list)) { errs.push(`accesoriales ${k} no es lista`); continue; }
    for (const a of list) if (!a?.concepto || typeof a.monto !== 'string') errs.push(`accesorial inválido ${k}`);
  }
  return errs;
}

export function setRateTables(d: RateTablesInput): void {
  const errs = validateRateTables(d);
  if (errs.length) throw new Error(`rateTable: datos de la base rechazados: ${errs.slice(0, 5).join('; ')}`);
  ROUTES_FL = d.routesFl;
  ROUTES_TX = d.routesTx;
  ACCESSORIALS_FL = d.accessorialsFl;
  ACCESSORIALS_TX = d.accessorialsTx;
  RATE_SOURCE = 'db';
}

export function resetRateTablesToBundled(): void {
  ROUTES_FL = BUNDLED_ROUTES_FL;
  ROUTES_TX = BUNDLED_ROUTES_TX;
  ACCESSORIALS_FL = BUNDLED_ACCESSORIALS_FL;
  ACCESSORIALS_TX = BUNDLED_ACCESSORIALS_TX;
  RATE_SOURCE = 'json';
}

export function getRateSource(): 'json' | 'db' {
  return RATE_SOURCE;
}

export function loadRoutes(estado: Estado): RouteRecord[] {
  return estado === 'FL' ? ROUTES_FL : ROUTES_TX;
}

export function loadAccessorials(estado: Estado): AccessorialRecord[] {
  const items = estado === 'FL' ? ACCESSORIALS_FL : ACCESSORIALS_TX;
  // Renombrar 'Waiting Time' a 'Detention' para que se muestre así en la UI (según preferencia del usuario)
  return items.map(item => {
    if (item.concepto === 'Waiting Time') {
      return { ...item, concepto: 'Detention' };
    }
    return item;
  });
}

export function getRouteCounts(): RouteCounts {
  return { fl: ROUTES_FL.length, tx: ROUTES_TX.length, total: ROUTES_FL.length + ROUTES_TX.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// BÚSQUEDA — match exacto (case/acento-insensible) de ciudad + tamaño dentro de
// un estado. La resolución de alias/ZIP/tolerancia a errores tipográficos es
// Fase 2 (nameResolution.ts); acá el match es literal a propósito, para poder
// probarlo de forma aislada sin acoplarlo a esa fase.
// ─────────────────────────────────────────────────────────────────────────────

function normalizarCiudad(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function lookupRoute(estado: Estado, ciudad: string, tamano: Tamano, mercado?: string | null): { route: RouteRecord; precio: RoutePriceEntry } | null {
  const objetivo = normalizarCiudad(ciudad);
  const rutas = loadRoutes(estado);
  for (const route of rutas) {
    if (normalizarCiudad(route.ciudad) !== objetivo) continue;
    if (mercado && route.mercado !== 'Ambos' && route.mercado !== 'MIA/PEV' && route.mercado !== mercado) continue;
    const precio = route.precios.find(p => p.tamano === tamano);
    if (precio) return { route, precio };
  }
  return null;
}


// Busca por `id` exacto (slug estable, ver shared/rateExcel.ts). Existe
// para la resolución por ZIP de Texas (nameResolution.ts, Fase 2): un ZIP
// identifica una fila específica sin la ambigüedad de "varias filas comparten
// la misma ciudad" que tiene lookupRoute por nombre (p. ej. Houston tiene 10
// filas). Devuelve el RouteRecord completo, no un precio por tamaño: el
// llamador decide con qué tamaño (nativo 40' o derivado) trabajar.
export function findRouteById(estado: Estado, id: string): RouteRecord | null {
  return loadRoutes(estado).find(r => r.id === id) || null;
}

/**
 * Busca la ruta con las millas más cercanas a las solicitadas en un estado,
 * para el tamaño de contenedor especificado. Esto se usa para asignar
 * tarifas planas (tramos cortos) en estados vecinos fuera de mercado.
 */
export function findClosestRouteByMiles(
  estado: Estado,
  tamano: Tamano,
  millasIda: number,
  isNeighborFallback: boolean = false
): { route: RouteRecord; precio: RoutePriceEntry } | null {
  let rutas = loadRoutes(estado);
  if (isNeighborFallback && estado === 'FL') {
    rutas = rutas.filter(r => r.mercado === 'MIA' || r.mercado === 'MIA/PEV' || r.mercado === 'Ambos');
  }
  let closest: { route: RouteRecord; precio: RoutePriceEntry; diff: number } | null = null;
  for (const route of rutas) {
    const precio = route.precios.find(p => p.tamano === tamano);
    if (!precio) continue;
    
    const diff = Math.abs(route.millas_ida - millasIda);
    if (!closest || diff < closest.diff) {
      closest = { route, precio, diff };
    }
  }
  
  return closest ? { route: closest.route, precio: closest.precio } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORTE DE RUTAS NO ENCONTRADAS (criterio de éxito 9, kickoff §7.9 y §12
// 14-A: "es justo la información que hace falta para saber qué agregar
// primero").
//
// Consumidor real (Decisión 14-A): cada ruta no encontrada se loguea de
// inmediato — apenas se registra, no en una lectura posterior — como línea
// estructurada en los logs de la función Base44, que sí son infraestructura
// existente y consultable por Juan/Mateo. El array en memoria (getUnmatchedRoutes)
// se conserva además para quien quiera leerlo dentro del mismo isolate, pero
// deja de ser el único consumidor: el log no depende de que el isolate siga
// vivo. No se agrega pantalla ni entidad nueva — eso excede el alcance de este
// SDD (kickoff §8, Alcance OUT).
// ─────────────────────────────────────────────────────────────────────────────

let unmatchedRoutes: UnmatchedRouteEntry[] = [];

export function recordUnmatchedRoute(ciudad: string, estado: Estado | string): void {
  try {
    if (!ciudad) return; // sin ciudad no hay nada útil que registrar — no se inventa un valor.
    const entry: UnmatchedRouteEntry = { ciudad, estado, timestamp: new Date().toISOString() };
    unmatchedRoutes.push(entry);
    // El logging en consola fue removido para evitar que se confunda con un error de ejecución,
    // ya que este evento es un comportamiento esperado que dispara el fallback automático.
  } catch (_error) {
    // Nunca debe interrumpir la respuesta al usuario por un problema de
    // reporting; es una señal de mejora continua, no una ruta crítica.
  }
}

export function getUnmatchedRoutes(): UnmatchedRouteEntry[] {
  return unmatchedRoutes;
}

export function clearUnmatchedRoutes(): void {
  unmatchedRoutes = [];
}
