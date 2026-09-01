// ─────────────────────────────────────────────────────────────────────────────
// RUTAS DE REFERENCIA — dominio puro, reglas-v3-multiestado Fase 3 (§3, T-7).
//
// Cuando la ruta consultada no está en la tabla, NUNCA se escala una tarifa
// plana por distancia (kickoff §3 — hay 26 grupos de tarifa en FL que se
// superponen en millaje, así que una tarifa plana no tiene sobre qué apoyarse
// para estirarse). En vez de eso, se ofrecen hasta 3 rutas reales del mismo
// estado (o del estado vecino con tabla, si el estado consultado no tiene
// ninguna), identificadas siempre como referencia — nunca como precio de la
// ruta pedida.
//
// Determinismo (criterio 12): mismo input → mismas 3 rutas, siempre. Orden por
// diferencia de millas, desempate estable por nombre de ciudad.
// ─────────────────────────────────────────────────────────────────────────────

import { loadRoutes, type Estado, type Tamano, type RouteRecord } from './rateTable.ts';

export interface ReferenceRoute {
  ciudad: string;
  millas_ida: number;
  objetivo: number;
  tamanoMostrado: Tamano;
}

function precioReferencia(route: RouteRecord, tamano: Tamano): { objetivo: number; tamanoMostrado: Tamano } | null {
  const directo = route.precios.find(p => p.tamano === tamano);
  if (directo) return { objetivo: directo.objetivo, tamanoMostrado: directo.tamano };
  // Texas solo trae 40' nativo en la fila; si se pide otro tamaño, la
  // referencia se muestra en 40' (el dato real de esa fila) en vez de invocar
  // la derivación acá — derivar una referencia sería mostrar un número que no
  // es ni tabla ni la ruta pedida, dos supuestos apilados sin necesidad.
  const nativo = route.precios.find(p => p.tamano === '40');
  return nativo ? { objetivo: nativo.objetivo, tamanoMostrado: nativo.tamano } : null;
}

/**
 * Hasta 3 rutas reales del `estado` dado, ordenadas por cercanía en millas a
 * `millasIda`, con desempate estable por nombre de ciudad (T-7, criterio 12).
 * `excludeCiudad` evita recomendar la propia ciudad consultada como "cercana a
 * sí misma" cuando esta función se usa en un contexto donde la ciudad sí se
 * pudo nombrar pero no traía fila para el tamaño pedido.
 */
export function selectReferenceRoutes(
  estado: Estado,
  tamano: Tamano,
  millasIda: number,
  excludeCiudad?: string | null,
): ReferenceRoute[] {
  const excluida = excludeCiudad ? excludeCiudad.trim().toLowerCase() : null;
  const candidatos: Array<ReferenceRoute & { diff: number }> = [];

  for (const route of loadRoutes(estado)) {
    if (excluida && route.ciudad.trim().toLowerCase() === excluida) continue;
    const precio = precioReferencia(route, tamano);
    if (!precio) continue;
    candidatos.push({
      ciudad: route.ciudad,
      millas_ida: route.millas_ida,
      objetivo: precio.objetivo,
      tamanoMostrado: precio.tamanoMostrado,
      diff: Math.abs(route.millas_ida - millasIda),
    });
  }

  candidatos.sort((a, b) => a.diff - b.diff || a.ciudad.localeCompare(b.ciudad));
  return candidatos.slice(0, 3).map(({ diff: _diff, ...resto }) => resto);
}

// ─────────────────────────────────────────────────────────────────────────────
// ESTADO VECINO — Decisión 11-A: siempre el estado más cercano de los que
// tenemos tabla, y se dice SOLO cuando es vecino cercano; para un estado lejano
// no se nombra el origen ("valores de referencia general del mercado").
//
// Reutiliza el mismo agrupamiento que el fallback de accesoriales (Fase 5,
// kickoff §7.6): Georgia/Carolinas/Alabama → Florida; Oklahoma/Nuevo
// México/Luisiana/Arkansas → Texas. Una sola tabla de geografía, dos
// consumidores — sin inventar un segundo criterio de cercanía.
// ─────────────────────────────────────────────────────────────────────────────

export const NEIGHBOR_STATE_GROUPS: Record<string, Estado> = {
  georgia: 'FL',
  'north carolina': 'FL',
  'south carolina': 'FL',
  alabama: 'FL',
  oklahoma: 'TX',
  'new mexico': 'TX',
  louisiana: 'TX',
  arkansas: 'TX',
};

function normalizeForStateMatch(value: unknown): string {
  return (value ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Busca en el texto un nombre de estado vecino cercano conocido. Nunca adivina uno lejano. */
export function detectNeighborState(texto: unknown): Estado | null {
  const normalizado = normalizeForStateMatch(texto);
  if (!normalizado) return null;
  for (const [nombre, estado] of Object.entries(NEIGHBOR_STATE_GROUPS)) {
    const patron = nombre.replace(/ /g, '\\s+');
    const re = new RegExp(`(^|[^a-z])${patron}([^a-z]|$)`);
    if (re.test(normalizado)) return estado;
  }
  return null;
}

export interface ReferenceStateResolution {
  estado: Estado;
  cercano: boolean;
}

/**
 * Decide de qué tabla salen las rutas de referencia cuando el estado
 * consultado no tiene tabla propia. `cercano=true` cuando el texto nombra un
 * estado vecino conocido (se nombra en la respuesta); `cercano=false` en
 * cualquier otro caso (estado lejano o no identificado) — la redacción usa
 * "valores de referencia general del mercado" y NO nombra ningún estado de
 * origen (Decisión 11-A).
 */
export function resolveReferenceState(textoOrigenODestino: unknown): ReferenceStateResolution {
  const vecino = detectNeighborState(textoOrigenODestino);
  if (vecino) return { estado: vecino, cercano: true };
  return { estado: 'TX', cercano: false };
}
