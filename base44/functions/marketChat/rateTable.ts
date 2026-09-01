// ─────────────────────────────────────────────────────────────────────────────
// TABLA DE RUTAS — dominio puro (sin llamadas de red, sin IA), reglas-v3-multiestado
// Fase 1 (conversión y carga).
//
// Carga los JSON versionados generados OFFLINE por scripts/convertRateTables.ts
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

import routesFlRaw from './data/routes.fl.json' with { type: 'json' };
import routesTxRaw from './data/routes.tx.json' with { type: 'json' };
import accessorialsFlRaw from './data/accessorials.fl.json' with { type: 'json' };
import accessorialsTxRaw from './data/accessorials.tx.json' with { type: 'json' };

const ROUTES_FL = routesFlRaw as unknown as RouteRecord[];
const ROUTES_TX = routesTxRaw as unknown as RouteRecord[];
const ACCESSORIALS_FL = accessorialsFlRaw as unknown as AccessorialRecord[];
const ACCESSORIALS_TX = accessorialsTxRaw as unknown as AccessorialRecord[];

// Guardarraíl de integridad (criterio de éxito 1): si el JSON versionado se
// edita a mano y el conteo se corrompe, el módulo falla al cargar en vez de
// servir una tabla incompleta en silencio.
const EXPECTED_FL_COUNT = 209;
const EXPECTED_TX_COUNT = 50;

if (ROUTES_FL.length !== EXPECTED_FL_COUNT) {
  throw new Error(`rateTable: se esperaban ${EXPECTED_FL_COUNT} rutas FL, el JSON versionado trae ${ROUTES_FL.length}`);
}
if (ROUTES_TX.length !== EXPECTED_TX_COUNT) {
  throw new Error(`rateTable: se esperaban ${EXPECTED_TX_COUNT} rutas TX, el JSON versionado trae ${ROUTES_TX.length}`);
}

export function loadRoutes(estado: Estado): RouteRecord[] {
  return estado === 'FL' ? ROUTES_FL : ROUTES_TX;
}

export function loadAccessorials(estado: Estado): AccessorialRecord[] {
  return estado === 'FL' ? ACCESSORIALS_FL : ACCESSORIALS_TX;
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

export function lookupRoute(estado: Estado, ciudad: string, tamano: Tamano): { route: RouteRecord; precio: RoutePriceEntry } | null {
  const objetivo = normalizarCiudad(ciudad);
  const rutas = loadRoutes(estado);
  for (const route of rutas) {
    if (normalizarCiudad(route.ciudad) !== objetivo) continue;
    const precio = route.precios.find(p => p.tamano === tamano);
    if (precio) return { route, precio };
  }
  return null;
}

// Busca por `id` exacto (slug estable, ver scripts/convertRateTables.ts). Existe
// para la resolución por ZIP de Texas (nameResolution.ts, Fase 2): un ZIP
// identifica una fila específica sin la ambigüedad de "varias filas comparten
// la misma ciudad" que tiene lookupRoute por nombre (p. ej. Houston tiene 10
// filas). Devuelve el RouteRecord completo, no un precio por tamaño: el
// llamador decide con qué tamaño (nativo 40' o derivado) trabajar.
export function findRouteById(estado: Estado, id: string): RouteRecord | null {
  return loadRoutes(estado).find(r => r.id === id) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORTE DE RUTAS NO ENCONTRADAS (criterio de éxito 9, kickoff §7.9 y §12
// 14-A: "es justo la información que hace falta para saber qué agregar
// primero"). Estructura de datos base — el consumo completo (endpoint/reporte
// visible) es de una fase posterior; acá solo se garantiza que la señal se
// capture y nunca bloquee ni rompa la respuesta al usuario.
//
// Vive en memoria del proceso: cada isolate de la función es efímero, así que
// esto es intencionalmente ligero. Cuando exista un consumidor real (Fase 7+),
// se decide ahí si conviene persistir a una entidad o exportar a un log.
// ─────────────────────────────────────────────────────────────────────────────

let unmatchedRoutes: UnmatchedRouteEntry[] = [];

export function recordUnmatchedRoute(ciudad: string, estado: Estado | string): void {
  try {
    if (!ciudad) return; // sin ciudad no hay nada útil que registrar — no se inventa un valor.
    unmatchedRoutes.push({ ciudad, estado, timestamp: new Date().toISOString() });
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
