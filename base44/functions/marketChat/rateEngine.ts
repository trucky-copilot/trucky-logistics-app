// ─────────────────────────────────────────────────────────────────────────────
// MOTOR DE TARIFAS — dominio puro, sin I/O y sin IA.
//
// Este módulo se extrajo de entry.ts SIN cambiar lógica: las firmas, los valores
// de retorno y el comportamiento son idénticos. Lo único que se agregó son los
// tipos explícitos, que se borran al compilar y no afectan la ejecución.
//
// La extracción existe para poder cubrir estas funciones con `deno test`:
// entry.ts llama a Deno.serve() en el nivel superior y no se puede importar
// desde una prueba sin levantar el servidor.
//
// REGLA: acá no entra nada que haga red, lea entidades ni invoque al LLM. Si una
// función necesita I/O, va en entry.ts.
//
// NOTA sobre los tipos: todo lo que viene del LLM se recibe como `unknown` a
// propósito. El schema de extracción no es una garantía —el modelo puede
// desviarse— así que estas funciones validan en vez de confiar. Eso ya era el
// comportamiento original; los tipos solo lo hacen explícito.
// ─────────────────────────────────────────────────────────────────────────────

export const FREIGHT_KB_VERSION = '1.0.0';

export interface Equipment {
  id: string;
  label: string;
  rpm_min: number;
  rpm_target: number;
}

export interface ResolvedEquipment extends Equipment {
  was_defaulted: boolean;
}

export interface FlatBucket {
  range: string;
  from: number;
  to: number;
  min: number;
  max: number | null;
}

export interface Lane {
  origen: string;
  destino: string;
  rt_miles: number;
  destino_aliases?: string[];
}

export interface LaneMatch {
  lane: Lane | null;
  portEverglades: boolean;
}

export interface ResolvedMiles {
  miles: number | null;
  source: 'catalog' | 'llm';
  lane_label: string | null;
  low_confidence: boolean;
  portEverglades: boolean;
  insufficient: boolean;
}

export type VerdictBand = 'reference' | 'reject' | 'negotiate' | 'accept';

export interface Verdict {
  emoji: string;
  label: string;
  band: VerdictBand;
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface RateCheckContext {
  origen: string | null;
  destino: string | null;
  miles: number;
  esRedondo: unknown;
  laneLabel: string | null;
  source: 'catalog' | 'llm';
  lowConfidence: boolean;
  equipment: ResolvedEquipment;
  floor: number;
  target: number;
  tarifaOfrecida: number | null;
  portEverglades: boolean;
  /** Qué regla puso el piso. Decide si se muestra la referencia por milla. */
  floorBasis: 'flat' | 'rpm';
  /** Rango del tramo que aplicó, para poder nombrarlo en la respuesta. */
  bucketRange: string;
}

// 7 equipos — el id se usa también como valor del enum "equipo" en EXTRACTION_SCHEMA
export const EQUIPMENT_BENCHMARKS: Equipment[] = [
  { id: 'dry_van', label: "53' Dry Van", rpm_min: 2.00, rpm_target: 2.50 },
  { id: 'reefer', label: 'Reefer', rpm_min: 2.30, rpm_target: 2.80 },
  { id: 'flatbed', label: 'Flatbed', rpm_min: 2.50, rpm_target: 3.00 },
  { id: 'step_deck', label: 'Step Deck', rpm_min: 2.75, rpm_target: 3.25 },
  { id: 'drayage_20', label: "Drayage/Container 20'", rpm_min: 2.75, rpm_target: 3.50 },
  { id: 'drayage_40', label: "Drayage/Container 40'", rpm_min: 2.50, rpm_target: 3.25 },
  { id: 'power_only', label: 'Power Only', rpm_min: 1.50, rpm_target: 1.75 },
];

// Mínimos flat rate por rango de millas REDONDO; from/to son límites [from, to)
export const FLAT_MINIMUMS: FlatBucket[] = [
  { range: '<50 mi', from: 0, to: 50, min: 400, max: 500 },
  { range: '50–100 mi', from: 50, to: 100, min: 500, max: 650 },
  { range: '100–200 mi', from: 100, to: 200, min: 650, max: 900 },
  { range: '200–400 mi', from: 200, to: 400, min: 900, max: 1400 },
  { range: '400–600 mi', from: 400, to: 600, min: 1400, max: 1800 },
  { range: '600–800 mi', from: 600, to: 800, min: 1800, max: 2400 },
  { range: '800+ mi', from: 800, to: Infinity, min: 2400, max: null },
];

// Catálogo de lanes (millas REDONDO). Gana sobre la estimación del LLM.
export const LANES: Lane[] = [
  { origen: 'Miami', destino: 'Tampa', rt_miles: 540 },
  { origen: 'Miami', destino: 'Fort Myers/Naples', rt_miles: 240, destino_aliases: ['fort myers', 'ft myers', 'naples'] },
  { origen: 'Miami', destino: 'West Palm Beach', rt_miles: 136, destino_aliases: ['wpb', 'west palm beach'] },
  { origen: 'Miami', destino: 'Fort Pierce', rt_miles: 230, destino_aliases: ['ft pierce'] },
  { origen: 'Miami', destino: 'Orlando', rt_miles: 470 },
  { origen: 'Miami', destino: 'Jacksonville', rt_miles: 680, destino_aliases: ['jax'] },
  { origen: 'Miami', destino: 'Pompano', rt_miles: 70, destino_aliases: ['pompano beach'] },
];

// Port Everglades es un MODIFICADOR (+$50 recargo de puerto), no una lane aparte.
export const PORT_EVERGLADES_SURCHARGE = 50;

// DETENTION unificado — único valor válido en todo el prompt
export const DETENTION = { standard: 75, min: 50, max: 100, free_hours: 2 };

export const ACCESSORIALS: Array<{ label: string; min: number; max: number; unit?: string }> = [
  { label: 'TONU', min: 150, max: 300 },
  { label: 'Pre-Pull', min: 100, max: 200 },
  { label: 'Chassis split', min: 75, max: 75, unit: '/día' },
  { label: 'Storage', min: 75, max: 150, unit: '/día' },
];

export const HISTORY_CAP = 8;

export const MAX_REQUEST_CHARS = 20000;

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZACIÓN DE TEXTO
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeText(value: unknown): string {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

export function matchesAny(text: string, tokens: string[]): boolean {
  return tokens.some(t => t && text.includes(t));
}

export const MIAMI_TOKENS = ['miami'];
export const PORT_EVERGLADES_TOKENS = ['port everglades', 'fort lauderdale', 'ft lauderdale'];
export const BASE_TOKENS = [...MIAMI_TOKENS, ...PORT_EVERGLADES_TOKENS];

// Busca la lane catalogada cuyo destino coincide con el extremo no-Miami de la
// consulta. Port Everglades cuenta como extremo "base" (zona de Miami) para el
// matching, pero además activa el recargo de puerto.
export function findLane(origenRaw: unknown, destinoRaw: unknown): LaneMatch {
  const a = normalizeText(origenRaw);
  const b = normalizeText(destinoRaw);
  const portEverglades = matchesAny(a, PORT_EVERGLADES_TOKENS) || matchesAny(b, PORT_EVERGLADES_TOKENS);
  const aEsBase = matchesAny(a, BASE_TOKENS);
  const bEsBase = matchesAny(b, BASE_TOKENS);

  let cityText = '';
  if (aEsBase && !bEsBase) cityText = b;
  else if (bEsBase && !aEsBase) cityText = a;

  if (!cityText) return { lane: null, portEverglades };

  const lane = LANES.find(l => {
    const tokens = [normalizeText(l.destino), ...(l.destino_aliases || [])];
    return tokens.some(t => t && (cityText.includes(t) || t.includes(cityText)));
  }) || null;

  return { lane, portEverglades };
}

// ─────────────────────────────────────────────────────────────────────────────
// ALCANCE DEL MERCADO — guardarraíl de honestidad (F2-03, versión acotada).
//
// El problema: resolveMiles cotiza igual cuando la ruta no está en el catálogo,
// siempre que el LLM haya estimado unas millas. Y el LLM estima cualquier cosa,
// así que el chat inventaba un piso para Savannah → Atlanta, donde no tenemos
// ni una tarifa.
//
// Por qué el guardarraíl es GEOGRÁFICO y no "está en el catálogo": el catálogo
// tiene 7 rutas y el mercado real ~210. Negarse a todo lo que no esté en las 7
// haría que el chat tampoco sirva para rutas legítimas de Florida (South Palm
// Beach → Wellington, por ejemplo). Se rechaza solo lo que está claramente
// fuera del mercado que cubrimos.
//
// Cuando la tabla v4 esté cargada (F2-01), la regla estricta por catálogo pasa a
// ser la correcta y esto queda como capa adicional, no como reemplazo.
// ─────────────────────────────────────────────────────────────────────────────

// Marcadores de que el punto SÍ está en el mercado cubierto. Se evalúan primero
// para que una ciudad de Florida nunca se confunda con su homónima de otro estado.
const FLORIDA_TOKENS = [
  'florida', 'miami', 'tampa', 'orlando', 'jacksonville', 'naples', 'fort myers',
  'ft myers', 'west palm', 'wpb', 'pompano', 'fort pierce', 'ft pierce',
  'everglades', 'lauderdale', 'hialeah', 'medley', 'doral', 'homestead',
  'boca raton', 'wellington', 'palm beach', 'sarasota', 'petersburg',
  'clearwater', 'ocala', 'gainesville', 'lakeland', 'kissimmee', 'canaveral',
  'melbourne', 'daytona', 'tallahassee', 'pensacola', 'key west', 'stuart',
  'vero beach', 'okeechobee', 'immokalee', 'plant city', 'winter haven',
  'port st lucie', 'jupiter', 'deerfield', 'coral springs', 'hollywood fl',
  'pomtoc', 'sfct', 'fit', 'pev', 'portmiami',
];

// Estados y plazas de fuera del mercado. Se listan las que aparecen de verdad en
// conversación de freight; no pretende ser exhaustivo, pretende atrapar el caso
// que avergüenza en una demo.
const FUERA_DE_MERCADO_TOKENS = [
  // estados
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
  'connecticut', 'delaware', 'georgia', 'hawaii', 'idaho', 'illinois',
  'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland',
  'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri',
  'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico',
  'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon',
  'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee',
  'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia',
  'wisconsin', 'wyoming',
  // plazas habituales de fuera
  'atlanta', 'savannah', 'charleston', 'charlotte', 'raleigh', 'nashville',
  'memphis', 'birmingham', 'mobile', 'new orleans', 'houston', 'dallas',
  'laredo', 'el paso', 'san antonio', 'austin', 'phoenix', 'los angeles',
  'long beach', 'oakland', 'seattle', 'chicago', 'detroit', 'cleveland',
  'columbus', 'indianapolis', 'kansas city', 'st louis', 'denver',
  'salt lake city', 'las vegas', 'newark', 'baltimore', 'norfolk',
  'philadelphia', 'boston', 'pittsburgh', 'cincinnati', 'louisville',
];

function contieneToken(texto: string, tokens: string[]): string | null {
  for (const t of tokens) {
    // Límite de palabra a ambos lados para que "fit" no coincida dentro de
    // "outfit" ni "fl" dentro de "flagler".
    const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
    if (re.test(texto)) return t;
  }
  return null;
}

// Un extremo está fuera de mercado si nombra un estado o una plaza de fuera y no
// trae ningún marcador de Florida. Ante la duda se considera dentro: es preferible
// cotizar una ruta local desconocida que negarse a trabajar en el propio mercado.
function extremoFueraDeMercado(raw: unknown): string | null {
  const texto = normalizeText(raw);
  if (!texto) return null;
  if (contieneToken(texto, FLORIDA_TOKENS)) return null;
  return contieneToken(texto, FUERA_DE_MERCADO_TOKENS);
}

/**
 * Devuelve el nombre del mercado ajeno detectado, o null si la ruta está dentro
 * del mercado cubierto (o no hay evidencia de que esté fuera).
 */
export function detectarFueraDeMercado(origen: unknown, destino: unknown): string | null {
  return extremoFueraDeMercado(origen) || extremoFueraDeMercado(destino);
}

/** Respuesta honesta cuando la ruta pedida está fuera del mercado cubierto. */
export function buildOutOfMarketMarkdown(origen: unknown, destino: unknown): string {
  const ruta = [origen, destino].filter(Boolean).join(' → ');
  const destinos = LANES.map(l => l.destino).join(', ');
  return [
    `📊 No tengo tarifas de esa ruta${ruta ? ` (${ruta})` : ''}.`,
    'Mis datos cubren drayage del sur de Florida: PortMiami y Port Everglades.',
    `Rutas con tarifa confirmada: ${destinos}.`,
    'Si necesitas esa zona, dime las millas y te calculo con referencias de mercado, aclarando que no es una tarifa de tabla.',
  ].join('\n');
}

// Resuelve millas RT: el catálogo gana sobre la estimación del LLM.
// Sin match en catálogo y sin millas_ida → insufficient=true (pedir aclaración,
// nunca inventar).
export function resolveMiles(
  origen: unknown,
  destino: unknown,
  millasIda: unknown,
  esRedondo: unknown,
): ResolvedMiles {
  const { lane, portEverglades } = findLane(origen, destino);
  const redondo = esRedondo !== false; // true por defecto

  if (lane) {
    const miles = redondo ? lane.rt_miles : Math.round(lane.rt_miles / 2);
    return { miles, source: 'catalog', lane_label: `Miami ↔ ${lane.destino}`, low_confidence: false, portEverglades, insufficient: false };
  }

  if (typeof millasIda === 'number' && isFinite(millasIda) && millasIda > 0) {
    const rt = redondo ? millasIda * 2 : millasIda;
    const miles = Math.round(rt);
    const low_confidence = miles < 10 || miles > 3000;
    return { miles, source: 'llm', lane_label: null, low_confidence, portEverglades, insufficient: false };
  }

  return { miles: null, source: 'llm', lane_label: null, low_confidence: false, portEverglades, insufficient: true };
}

// dry_van es el fallback y siempre existe en el catálogo de equipos.
const DRY_VAN: Equipment = EQUIPMENT_BENCHMARKS.find(e => e.id === 'dry_van')!;

// OJO: cualquier id que no esté en EQUIPMENT_BENCHMARKS cae en dry_van. Eso
// incluye "drayage" a secas, porque el enum solo tiene drayage_20 y drayage_40.
// Es el defecto que corrige TRUCKY-48 (F2-09); acá se conserva el comportamiento
// actual a propósito, y las pruebas lo documentan como tal.
export function normalizeEquipment(raw: unknown): ResolvedEquipment {
  const found = EQUIPMENT_BENCHMARKS.find(e => e.id === raw);
  if (found) return { ...found, was_defaulted: false };
  return { ...DRY_VAN, was_defaulted: true };
}

export function getFlatBucket(miles: number): FlatBucket {
  return FLAT_MINIMUMS.find(b => miles >= b.from && miles < b.to) || FLAT_MINIMUMS[FLAT_MINIMUMS.length - 1];
}

// Regla de oro: piso = MAYOR entre el flat mínimo del tramo y el RPM mínimo del
// equipo × millas RT.
export function computeFloor(miles: number, rpmMin: number, flatMin: number, surcharge = 0): number {
  return Math.max(flatMin, Math.round(rpmMin * miles)) + surcharge;
}

export function computeTarget(miles: number, rpmTarget: number, flatMax: number | null, surcharge = 0): number {
  return Math.max(flatMax ?? 0, Math.round(rpmTarget * miles)) + surcharge;
}

/**
 * Qué regla gobierna el piso: el mínimo del tramo o el cálculo por milla.
 *
 * Existe para no mostrar una referencia por milla al lado de una cifra que no
 * salió de ella. En una ruta corta el piso lo pone el mínimo del tramo —$400 en
 * 30 millas son $13/mi— y enseñar "$2.00–$2.50/mi" ahí hace que el dispatcher
 * crea que se le está cotizando por milla. Es el hallazgo de la revisión sobre
 * F2-00: el cálculo estaba bien, lo que confundía era la presentación.
 */
export function resolveFloorBasis(miles: number, rpmMin: number, flatMin: number): 'flat' | 'rpm' {
  return flatMin >= Math.round(rpmMin * miles) ? 'flat' : 'rpm';
}

export function computeVerdict(tarifa: number | null, floor: number, target: number): Verdict {
  if (tarifa == null) return { emoji: '📊', label: 'REFERENCIA', band: 'reference' };
  if (tarifa < floor) return { emoji: '🔴', label: 'RECHAZAR', band: 'reject' };
  if (tarifa < target) return { emoji: '🟡', label: 'NEGOCIAR', band: 'negotiate' };
  return { emoji: '🟢', label: 'ACEPTAR', band: 'accept' };
}

export function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ARMADO DE RESPUESTAS — puro: recibe datos, devuelve texto.
// ─────────────────────────────────────────────────────────────────────────────

// El desglose numérico SIEMPRE está presente: piso, objetivo, RPM ofrecida vs
// mínima, y diferencia en dólares.
export function buildRateCheckMarkdown(ctx: RateCheckContext): string {
  const { origen, destino, miles, esRedondo, laneLabel, source, lowConfidence, equipment, floor, target, tarifaOfrecida, portEverglades, floorBasis, bucketRange } = ctx;

  const rutaLabel = origen && destino ? `${origen} → ${destino}` : (laneLabel || 'Ruta solicitada');
  // "millas estimadas" se muestra siempre que la milla venga del LLM y no del
  // catálogo; "confianza baja" es una señal extra para estimaciones fuera del
  // rango de sanidad (10–3000 mi).
  const millasTag = `~${miles} mi ${esRedondo === false ? 'solo ida' : 'redondo'}${source === 'llm' ? ' · millas estimadas' : ''}${lowConfidence ? ' · confianza baja' : ''}`;
  const equipoTag = `${equipment.label}${equipment.was_defaulted ? ' (asumido dry van)' : ''}`;
  const puertoTag = portEverglades ? ` · +$${PORT_EVERGLADES_SURCHARGE} recargo Port Everglades incluido` : '';

  // Solo se muestra la referencia por milla cuando ES la que puso el piso. Si el
  // piso lo puso el mínimo del tramo, se nombra ese mínimo y se da su equivalente
  // por milla, para que las dos cifras de la pantalla no se contradigan.
  const mercadoLine = floorBasis === 'flat'
    ? `📐 Manda el mínimo del tramo ${bucketRange} · equivale a $${(miles > 0 ? floor / miles : 0).toFixed(2)}/mi con estas millas · Equipo: ${equipoTag}`
    : `💰 Mercado: $${equipment.rpm_min.toFixed(2)}–$${equipment.rpm_target.toFixed(2)}/mi · Equipo: ${equipoTag}`;

  if (tarifaOfrecida == null) {
    return [
      `📊 **REFERENCIA** | Piso: ${formatUSD(floor)} | Objetivo: ${formatUSD(target)}`,
      `📍 ${rutaLabel} (${millasTag}${puertoTag})`,
      mercadoLine,
      `💡 Confirma origen, destino, millas y equipo para afinar la cifra.`,
      `¿Cuánto te ofrecen? Te digo si conviene.`,
    ].join('\n');
  }

  const rpmOfrecida = miles > 0 ? tarifaOfrecida / miles : 0;
  const verdict = computeVerdict(tarifaOfrecida, floor, target);
  const diferencia = tarifaOfrecida - floor;
  const posicion = tarifaOfrecida < floor ? 'bajo el piso' : (tarifaOfrecida < target ? 'entre piso y objetivo' : 'sobre objetivo');
  const consejo = verdict.band === 'reject'
    ? `Bajo el piso; contrarresta en ${formatUSD(floor)} mínimo.`
    : verdict.band === 'negotiate'
      ? `Negocia hacia ${formatUSD(target)}; hay margen.`
      : 'Buena tarifa, confirma el RC rápido.';

  return [
    `${verdict.emoji} **${verdict.label}** | Piso: ${formatUSD(floor)} | Objetivo: ${formatUSD(target)}`,
    `📍 ${rutaLabel} (${millasTag}${puertoTag})`,
    mercadoLine,
    // El "mínimo por milla" que se compara debe ser el que de verdad gobierna el
    // piso, no el benchmark del equipo: si no, en ruta corta el dispatcher lee
    // que le ofrecen más del mínimo por milla y sin embargo el veredicto rechaza.
    `🧮 Ofrecen ${formatUSD(tarifaOfrecida)} = $${rpmOfrecida.toFixed(2)}/mi (mín $${(floorBasis === 'flat' && miles > 0 ? floor / miles : equipment.rpm_min).toFixed(2)}/mi) → ${posicion}, diferencia ${diferencia >= 0 ? '+' : ''}${formatUSD(diferencia)} vs piso`,
    `💡 ${consejo}`,
  ].join('\n');
}

export function buildGeneralMarkdown(respuestaGeneral: unknown): string {
  if (typeof respuestaGeneral !== 'string' || !respuestaGeneral.trim()) {
    return safeFallbackContent();
  }
  return respuestaGeneral.trim();
}

// Cuando no hay lane catalogada ni millas_ida: pedir aclaración en vez de
// inventar un piso.
export function buildMissingDataMarkdown(): string {
  return [
    '📊 Necesito más datos para calcular el piso y el objetivo.',
    'Dime origen, destino y millas (o si es "solo ida") — con eso te doy el número exacto.',
  ].join('\n');
}

export function safeFallbackContent(): string {
  return '⚠️ No pude procesar la consulta; reintenta. Para tarifas incluye origen, destino, millas y equipo.';
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDACIÓN Y RECORTE DE ENTRADA
// ─────────────────────────────────────────────────────────────────────────────

export function capHistory(messages: ChatMessage[], n: number = HISTORY_CAP): ChatMessage[] {
  return messages.slice(-n);
}

export function isValidMessages(messages: unknown): messages is ChatMessage[] {
  return Array.isArray(messages) && messages.length > 0 && messages.every(m =>
    m && typeof m === 'object' && typeof m.role === 'string' && typeof m.content === 'string'
  );
}
