// ─────────────────────────────────────────────────────────────────────────────
// RESOLUCIÓN DE NOMBRES — dominio puro, reglas-v3-multiestado Fase 2.
//
// Reemplaza el matching por substring de `findLane` (removido de rateEngine.ts
// en la Fase 3) por resolución determinista contra la tabla de alias
// (data/aliases.json) y la tabla de rutas (rateTable.ts). Mismo principio que
// el resto del motor: ANTE LA DUDA, SE PREGUNTA — nunca se adivina la ciudad
// más parecida.
//
// Tres fuentes de resolución, en este orden de precedencia:
//   1. ZIP de Texas → identifica una FILA exacta de la tabla (routeId), sin la
//      ambigüedad de "varias filas comparten ciudad" que tiene el match por
//      nombre (Houston sola tiene 10 filas).
//   2. Alias de terminal/puerto de Florida (POMTOC, SFCT, FIT, PET, PEV,
//      PortMiami, MIA, Everglades, Broward) → mercado ('MIA' | 'PEV').
//   3. Nombre de ciudad, con tolerancia a acentos y abreviaturas comunes
//      ("Ft" → "Fort", "St"/"St." → "Saint", "Mt"/"Mt." → "Mount"), contra la
//      lista de ciudades de cada estado. FL y TX no comparten ningún nombre de
//      ciudad (verificado), así que un match de ciudad resuelve también el
//      estado sin ambigüedad.
//
// Si ninguna de las tres resuelve, el resultado es 'ask' — nunca un match
// aproximado por distancia de edición ni el más parecido.
// ─────────────────────────────────────────────────────────────────────────────

import aliasesRaw from './data/aliases.json' with { type: 'json' };
import { loadRoutes, findRouteById, type Estado } from './rateTable.ts';

interface AliasesFile {
  fl: { terminales: Record<string, 'MIA' | 'PEV'> };
  tx: { zip_a_ruta: Record<string, string> };
}

const ALIASES = aliasesRaw as unknown as AliasesFile;

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZACIÓN — acentos, mayúsculas y abreviaturas comunes de nombre de
// ciudad de EE.UU. La lista de abreviaturas es intencionalmente corta: solo
// cubre lo que de verdad aparece en las 259 rutas cargadas (Fort/Ft, Saint/St,
// Mount/Mt). Agregar una entrada nueva sin que aparezca en la tabla sería
// adivinar sin evidencia.
// ─────────────────────────────────────────────────────────────────────────────

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeText(value: unknown): string {
  return stripDiacritics((value ?? '').toString()).toLowerCase().trim();
}

const ABBREVIATIONS: Record<string, string> = {
  ft: 'fort',
  st: 'saint',
  mt: 'mount',
};

// Convierte un nombre de ciudad en una clave comparable: sin puntuación, sin
// acentos, palabras de abreviatura expandidas. "Ft Myers", "Ft. Myers" y
// "Fort Myers" producen la misma clave; "St. Augustine" y "Saint Augustine"
// también.
function canonicalKey(value: unknown): string {
  const sinPuntuacion = normalizeText(value).replace(/[.'"]/g, ' ');
  const tokens = sinPuntuacion.split(/[\s-]+/).filter(Boolean);
  return tokens.map(t => ABBREVIATIONS[t] || t).join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTAS DE CIUDAD POR ESTADO — derivadas de la tabla ya cargada (rateTable.ts),
// no de un catálogo aparte. Una sola fuente de verdad para "qué ciudades
// existen": si mañana se agrega una ciudad a la tabla, se resuelve por nombre
// sin tocar este archivo.
// ─────────────────────────────────────────────────────────────────────────────

function ciudadesDe(estado: Estado): string[] {
  const vistas = new Set<string>();
  const resultado: string[] = [];
  for (const r of loadRoutes(estado)) {
    if (!vistas.has(r.ciudad)) {
      vistas.add(r.ciudad);
      resultado.push(r.ciudad);
    }
  }
  return resultado;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUCIÓN INDIVIDUAL — cada función es pura y determinista: la misma
// entrada siempre da la misma salida (criterio 12, "10 intentos, mismo
// resultado" — aquí no hay ordenamiento que romper, pero el principio de
// determinismo del motor completo empieza en la resolución de nombres).
// ─────────────────────────────────────────────────────────────────────────────

export interface FlTerminalMatch {
  mercado: 'MIA' | 'PEV';
  aliasUsado: string;
}

/** Resuelve un código de terminal/puerto de Florida a su mercado. Nunca adivina. */
export function resolveFlTerminal(raw: unknown): FlTerminalMatch | null {
  const clave = normalizeText(raw).replace(/[.\s]/g, '');
  const mercado = ALIASES.fl.terminales[clave];
  if (!mercado) return null;
  return { mercado, aliasUsado: clave };
}

export interface TxZipMatch {
  ciudad: string;
  routeId: string;
  mercado: string;
}

/** Resuelve un ZIP de Texas a la fila exacta de la tabla que le corresponde. */
export function resolveTxZip(raw: unknown): TxZipMatch | null {
  const zip = normalizeText(raw).replace(/\s/g, '');
  if (!/^\d{5}$/.test(zip)) return null;
  const routeId = ALIASES.tx.zip_a_ruta[zip];
  if (!routeId) return null;
  const route = findRouteById('TX', routeId);
  if (!route) return null; // aliases.json y routes.tx.json desincronizados — no se inventa una ciudad
  return { ciudad: route.ciudad, routeId: route.id, mercado: route.mercado };
}

export interface CiudadMatch {
  ciudad: string;
}

/** Match tolerante (acentos + abreviaturas) contra la lista de ciudades de un estado. */
export function resolveCiudad(estado: Estado, raw: unknown): CiudadMatch | null {
  const clave = canonicalKey(raw);
  if (!clave) return null;
  for (const ciudad of ciudadesDe(estado)) {
    if (canonicalKey(ciudad) === clave) return { ciudad };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUCIÓN COMBINADA — la que consume rateEngine.ts. Prueba las fuentes en
// orden de precedencia y nunca completa con una adivinanza: si ninguna
// resuelve, el resultado es 'ask'.
// ─────────────────────────────────────────────────────────────────────────────

export type LocationResolution =
  | {
      status: 'ok';
      estado: Estado;
      ciudad: string | null; // null cuando solo se resolvió el mercado de origen (terminal), no una ciudad destino
      mercado: string | null;
      routeId: string | null;
      matchedVia: 'zip' | 'alias_terminal' | 'ciudad';
    }
  | { status: 'ask' };

export function resolveLocation(raw: unknown): LocationResolution {
  const zip = resolveTxZip(raw);
  if (zip) {
    return { status: 'ok', estado: 'TX', ciudad: zip.ciudad, mercado: zip.mercado, routeId: zip.routeId, matchedVia: 'zip' };
  }

  const terminal = resolveFlTerminal(raw);
  if (terminal) {
    return { status: 'ok', estado: 'FL', ciudad: null, mercado: terminal.mercado, routeId: null, matchedVia: 'alias_terminal' };
  }

  const fl = resolveCiudad('FL', raw);
  if (fl) {
    return { status: 'ok', estado: 'FL', ciudad: fl.ciudad, mercado: null, routeId: null, matchedVia: 'ciudad' };
  }

  const tx = resolveCiudad('TX', raw);
  if (tx) {
    return { status: 'ok', estado: 'TX', ciudad: tx.ciudad, mercado: null, routeId: null, matchedVia: 'ciudad' };
  }

  return { status: 'ask' };
}
