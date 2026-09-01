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
//
// ─────────────────────────────────────────────────────────────────────────────
// reglas-v3-multiestado, Fase 3 (inversión del motor) — LO QUE CAMBIÓ ACÁ:
//
// SE ELIMINÓ POR COMPLETO (no solo se dejó de llamar — grep-verificado sin
// referencias en ningún archivo):
//   - `LANES` / `findLane` (catálogo viejo de 7 lanes hardcodeadas de Miami).
//     Competía como fuente de verdad paralela justo para esas rutas — con la
//     tabla real de 259 rutas cargada (Fase 1), un catálogo aparte de 7 lanes
//     inventadas es directamente incorrecto, no solo redundante.
//   - `detectarFueraDeMercado` / `buildOutOfMarketMarkdown` (el guardarraíl
//     geográfico). El principio de "nunca se rechaza por falta de tabla" lo
//     reemplaza: ahora TODO se calcula, y la tabla refina cuando hay match.
//   - El camino `source: 'llm'` de `resolveMiles` (la estimación de millas del
//     LLM). Las millas ahora salen SOLO de la tabla, del usuario, o se
//     preguntan — nunca se estiman.
//   - El sistema de piso/objetivo por tramo flat (`FLAT_MINIMUMS`,
//     `getFlatBucket`, el `computeFloor`/`computeTarget`/`resolveFloorBasis`
//     viejos): quedaba como código muerto compitiendo con el nuevo modelo
//     consciente de tabla (`computeFloorTarget`) — Fase 4 introduce el
//     reemplazo correcto (mínimos v3 §7 por equipo, no genéricos por tramo).
//
// SE MANTUVO SIN TOCAR (no es parte de este cambio, otra función distinta):
//   - `FLORIDA_TOKENS` / `contieneToken`: aunque el guardarraíl geográfico los
//     usaba, TAMBIÉN alimentan `DOMAIN_TOKENS` para el guardarraíl de TEMA
//     (`esConsultaDeNegocio`/`esFueraDeTema`/`resolveIntent`) — una feature
//     completamente distinta (decide si el mensaje es de negocio de freight,
//     no si la ruta está en el mercado geográfico cubierto). Borrarlos habría
//     roto esa feature sin necesidad; se documenta acá para que quede claro
//     que no es un olvido.
// ─────────────────────────────────────────────────────────────────────────────

import {
  lookupRoute,
  recordUnmatchedRoute,
  loadAccessorials,
  type Estado,
  type Tamano,
  type RouteRecord,
  type AccessorialRecord,
} from './rateTable.ts';
import { resolveLocation } from './nameResolution.ts';
import { TX_SIZE_FACTORS, deriveTxPrice } from './sizeDerivation.ts';
import {
  selectReferenceRoutes,
  resolveReferenceState,
  detectNeighborState,
  type ReferenceRoute,
} from './referenceRoutes.ts';

export const FREIGHT_KB_VERSION = '2.0.0';

export interface Equipment {
  id: string;
  label: string;
  rpm_min: number;
  rpm_target: number;
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

// 7 equipos — el id se usa también como valor del enum "equipo" en EXTRACTION_SCHEMA.
//
// reglas-v3-multiestado (kickoff §6): dry_van, reefer y flatbed cambian su
// referencia por milla. La tabla vieja usaba un par (mín/objetivo) por equipo;
// para estos tres, el kickoff da UNA sola cifra ("RPM base"), así que ambos
// campos quedan iguales a esa cifra — el par min/target para ellos ya no
// representa dos umbrales distintos, sino el mismo RPM base usado dos veces
// para no romper la forma `Equipment` que consume el resto del motor.
// step_deck/drayage_20/drayage_40/power_only NO cambian — el kickoff no los
// menciona.
export const EQUIPMENT_BENCHMARKS: Equipment[] = [
  { id: 'dry_van', label: "53' Dry Van", rpm_min: 3.01, rpm_target: 3.01 },
  { id: 'reefer', label: 'Reefer', rpm_min: 3.42, rpm_target: 3.42 },
  { id: 'flatbed', label: 'Flatbed', rpm_min: 3.64, rpm_target: 3.64 },
  { id: 'step_deck', label: 'Step Deck', rpm_min: 2.75, rpm_target: 3.25 },
  { id: 'drayage_20', label: "Drayage/Container 20'", rpm_min: 2.75, rpm_target: 3.50 },
  { id: 'drayage_40', label: "Drayage/Container 40'", rpm_min: 2.50, rpm_target: 3.25 },
  { id: 'power_only', label: 'Power Only', rpm_min: 1.50, rpm_target: 1.75 },
];

// DETENTION unificado — único valor válido en todo el prompt
export const DETENTION = { standard: 75, min: 50, max: 100, free_hours: 2 };

export const ACCESSORIALS: Array<{ label: string; min: number; max: number; unit?: string }> = [
  { label: 'TONU', min: 150, max: 300 },
  { label: 'Pre-Pull', min: 100, max: 200 },
  { label: 'Chassis split', min: 75, max: 75, unit: '/día' },
  { label: 'Storage', min: 75, max: 150, unit: '/día' },
];

// reglas-v3-multiestado Fase 7 (frontera LLM/datos, criterio 4): estas cifras
// vivían como literales sueltos dentro del texto de BASE_CONTEXT en entry.ts.
// Se extraen acá como constantes únicas para que entry.ts las interpole (en
// vez de repetirlas a mano) y para que llmDataBoundary.ts pueda armar el
// conjunto de "cifras de KB permitidas" en una respuesta general sin
// duplicar los números por otro lado — una sola fuente de verdad.
export const HOS_LIMITS = {
  driving_hours: 11,
  on_duty_hours: 14,
  break_minutes: 30,
  break_after_hours: 8,
  hours_8_days: 70,
  hours_7_days: 60,
};

export const DEADHEAD_THRESHOLDS = {
  ok_pct: 20,
  concerning_pct: 40,
  long_deadhead_miles: 100,
  extra_rpm_min: 1.00,
  extra_rpm_max: 1.50,
};

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

// ─────────────────────────────────────────────────────────────────────────────
// GUARDARRAÍL DE TEMA — Decisión 1: backstop determinista de alcance de tema.
// (Feature preexistente, NO tocada por reglas-v3-multiestado — ver nota de
// cabecera. FLORIDA_TOKENS sigue viva acá porque DOMAIN_TOKENS la usa.)
//
// El LLM ya recibe instrucciones de solo responder freight en el prompt, pero
// eso no es determinista. esConsultaDeNegocio re-tokeniza el último mensaje
// del dispatcher contra el vocabulario de la KB.
//
// Precedencia en resolveIntent: rate_check > allowlist de negocio > blocklist
// (blocklist llega en la Fase 2 original de esta feature, no de este SDD).
// ─────────────────────────────────────────────────────────────────────────────

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

function contieneToken(texto: string, tokens: string[]): string | null {
  for (const t of tokens) {
    // Límite de palabra a ambos lados para que "fit" no coincida dentro de
    // "outfit" ni "fl" dentro de "flagler".
    const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
    if (re.test(texto)) return t;
  }
  return null;
}

// Vocabulario de negocio: equipos, cargos, documentos, geografía cubierta.
const DOMAIN_TOKENS = [
  'drayage', 'contenedor', 'container', 'chasis', 'chassis', 'per diem',
  'demurrage', 'detention', 'tonu', 'twic', 'bol', 'rate confirmation',
  'red confirmation', 'backhaul', 'void check', 'broker', 'carrier',
  'dispatcher', 'diesel', 'mpg', 'milla', 'millas', 'tarifa', 'carga', 'load',
  'puerto', 'terminal', 'hos', 'deadhead', 'reefer', 'flatbed', 'dry van',
  'power only', 'step deck', 'pre-pull', 'prepull', 'storage', 'rpm',
  ...FLORIDA_TOKENS,
];

/** true si el texto contiene vocabulario de negocio de la KB — la allowlist. */
export function esConsultaDeNegocio(texto: unknown): boolean {
  const normalizado = normalizeText(texto);
  if (!normalizado) return false;
  return contieneToken(normalizado, DOMAIN_TOKENS) !== null;
}

/** Contenido del último mensaje del dispatcher (role 'user'), o '' si no hay. */
export function ultimoMensajeDelDispatcher(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
}

// TEMPORARY: blocklist de demo, remover después del 2026-08-18 (#7784 item 1).
const OFF_TOPIC_TOKENS = [
  // 1. programación
  'python', 'javascript', 'codigo', 'programa', 'programar', 'algoritmo', 'script',
  // 2. clima
  'clima', 'pronostico del tiempo', 'va a llover',
  // 3. deportes
  'futbol', 'partido de futbol', 'campeonato',
  // 4. recetas
  'receta', 'cocinar', 'ingredientes de cocina',
  // 5. política
  'eleccion', 'elecciones', 'candidato presidencial',
  // 6. traducción
  'traduce', 'traducir', 'how do you say',
  // 7. chistes
  'chiste', 'cuentame una broma',
];

// 8va categoría: aritmética pura sin referente de freight.
const PURE_ARITHMETIC_RE = /\d+\s*%\s*(de|of)\s*\$?\s*[\d,.]+/;

/** true si el texto cae en una de las 8 categorías de demo Y no hay término de la KB. */
export function esFueraDeTema(texto: unknown): boolean {
  const normalizado = normalizeText(texto);
  if (!normalizado) return false;
  if (esConsultaDeNegocio(normalizado)) return false; // la allowlist siempre gana
  if (contieneToken(normalizado, OFF_TOPIC_TOKENS) !== null) return true;
  return PURE_ARITHMETIC_RE.test(normalizado);
}

/**
 * Decide el intent final con precedencia determinista:
 *   1. raw === 'rate_check'                                  → 'rate_check'  (nunca se declina)
 *   2. esConsultaDeNegocio(último mensaje)                    → 'general'     (la allowlist rescata)
 *   3. raw === 'off_topic' || esFueraDeTema(último mensaje)   → 'off_topic'   (LLM o blocklist temporal)
 *   4. cualquier otro caso                                    → 'general'     (comportamiento por defecto)
 */
export function resolveIntent(raw: unknown, messages: ChatMessage[]): 'rate_check' | 'general' | 'off_topic' {
  if (raw === 'rate_check') return 'rate_check';
  const ultimo = ultimoMensajeDelDispatcher(messages);
  if (esConsultaDeNegocio(ultimo)) return 'general';
  if (raw === 'off_topic' || esFueraDeTema(ultimo)) return 'off_topic';
  return 'general';
}

/** Respuesta de rechazo cuando el mensaje no es de negocio. Sin cifras. */
export function buildOffTopicMarkdown(): string {
  return [
    '🚚 Solo manejo temas de freight: tarifas, rutas y operación de drayage en el sur de Florida.',
    'Pregúntame por tarifas, rutas u operación y te respondo al instante.',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUCIÓN DE EQUIPO — sin cambios de comportamiento en esta fase (sigue
// siendo el camino para equipos SIN tabla: dry_van/reefer/flatbed/step_deck/
// power_only). El equipo "drayage" ya NO pasa por acá — Fase 3 lo resuelve
// nativamente contra la tabla + derivación de tamaño (ver resolveDrayageQuote
// más abajo); combineEquipoTamano (el puente temporal de la Fase 0) se retira
// porque ya no hace falta.
// ─────────────────────────────────────────────────────────────────────────────

export type EquipmentResolution =
  | { status: 'ok'; equipment: Equipment }
  | { status: 'ask'; reason: 'missing' | 'size' };

const CONTAINER_WITHOUT_SIZE_TOKENS = ['drayage', 'container', 'contenedor'];

export function resolveEquipment(raw: unknown): EquipmentResolution {
  const found = EQUIPMENT_BENCHMARKS.find(e => e.id === raw);
  if (found) return { status: 'ok', equipment: found };
  if (typeof raw === 'string' && CONTAINER_WITHOUT_SIZE_TOKENS.includes(raw)) {
    return { status: 'ask', reason: 'size' };
  }
  return { status: 'ask', reason: 'missing' };
}

/** Copia distinta según qué le falta al equipo: el equipo entero, o solo el tamaño. */
export function buildEquipmentQuestionMarkdown(reason: 'missing' | 'size'): string {
  if (reason === 'size') {
    return [
      '📦 Para darte un piso preciso necesito el tamaño del contenedor.',
      "¿Es un contenedor de 20', 40', 45' o 20' Heavy?",
    ].join('\n');
  }
  return [
    '📦 Para calcular el piso necesito saber el equipo.',
    '¿Con qué equipo lo mueves? (dry van, reefer, flatbed, step deck, drayage, power only)',
  ].join('\n');
}

export function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// TRUCKY-53 Q5: el label es una sugerencia, no una orden. El emoji y el band
// (el semáforo) quedan igual — solo cambia el texto del label.
//
// reglas-v3-multiestado Fase 3: `floor` ahora puede ser `null` (FL sin tabla
// de piso y sin dato del usuario — ver computeFloorTarget). Sin piso no hay
// forma de "rechazar por debajo del piso", así que ese caso cae a comparar
// solo contra el objetivo. El comportamiento con floor numérico (todas las
// pruebas viejas) no cambia un bit.
export function computeVerdict(tarifa: number | null, floor: number | null, target: number): Verdict {
  if (tarifa == null) return { emoji: '📊', label: 'REFERENCIA', band: 'reference' };
  if (floor != null && tarifa < floor) return { emoji: '🔴', label: 'TE SUGIERO PEDIR MÁS', band: 'reject' };
  if (tarifa < target) return { emoji: '🟡', label: 'TE SUGIERO NEGOCIAR', band: 'negotiate' };
  return { emoji: '🟢', label: 'TE SUGIERO TOMARLA', band: 'accept' };
}

// ─────────────────────────────────────────────────────────────────────────────
// PISO / OBJETIVO CONSCIENTES DE TABLA — reglas-v3-multiestado Fase 3, task 3.7.
//
// Reemplaza el sistema viejo de tramos flat (computeFloor/computeTarget por
// bucket genérico). Regla unificada, la misma para drayage con tabla, drayage
// sin tabla y cualquier otro equipo:
//
//   OBJETIVO:
//     - hay tabla (nativa o derivada de TX) → el objetivo ES la tabla.
//     - no hay tabla → objetivo = RPM base del equipo × millas de ida.
//
//   PISO:
//     - Texas trae piso de tabla (nativo o derivado) → el piso ES la tabla.
//     - Florida NUNCA trae piso de tabla (columna OO — NO EN USO). El piso
//       sale del dato del usuario (lo que le paga al camión, Decisión 9-B).
//     - Sin tabla de piso y sin dato del usuario → NO HAY PISO, y se declara
//       explícitamente (nunca se inventa uno).
// ─────────────────────────────────────────────────────────────────────────────

export interface FloorTargetInput {
  tablaPiso: number | null;
  tablaObjetivo: number | null;
  targetEsDerivado: boolean;
  millasIda: number;
  rpmBase: number | null;
  pagoCamionRpm: number | null;
  // reglas-v3-multiestado Fase 4: mínimo de tramo corto (v3 §7). Solo se pasa
  // desde el camino que lo admite (resolveGenericQuote); drayage sin tabla NO
  // lo usa — sigue con su propio benchmark, sin cambios de esta tarea.
  tramoCorto?: { floor: number; target: number } | null;
}

export interface FloorTargetResult {
  floor: number | null;
  floorSource: 'tabla' | 'dato_usuario' | 'tramo_corto' | 'sin_dato';
  target: number;
  targetSource: 'tabla' | 'derivado' | 'calculo' | 'tramo_corto';
}

export function computeFloorTarget(input: FloorTargetInput): FloorTargetResult {
  const tramoCortoAplica = !!input.tramoCorto && input.millasIda < SHORT_HAUL_MILES_THRESHOLD;

  let target: number;
  let targetSource: FloorTargetResult['targetSource'];
  if (input.tablaObjetivo != null) {
    target = input.tablaObjetivo;
    targetSource = input.targetEsDerivado ? 'derivado' : 'tabla';
  } else if (tramoCortoAplica) {
    target = input.tramoCorto!.target;
    targetSource = 'tramo_corto';
  } else {
    target = Math.round((input.rpmBase ?? 0) * input.millasIda);
    targetSource = 'calculo';
  }

  let floor: number | null;
  let floorSource: FloorTargetResult['floorSource'];
  if (input.tablaPiso != null) {
    floor = input.tablaPiso;
    floorSource = 'tabla';
  } else if (input.pagoCamionRpm != null) {
    floor = Math.round(input.pagoCamionRpm * input.millasIda);
    floorSource = 'dato_usuario';
  } else if (tramoCortoAplica) {
    floor = input.tramoCorto!.floor;
    floorSource = 'tramo_corto';
  } else {
    floor = null;
    floorSource = 'sin_dato';
  }

  return { floor, floorSource, target, targetSource };
}

// ─────────────────────────────────────────────────────────────────────────────
// SEGUNDA LECTURA (ida y vuelta) — reglas-v3-multiestado Fase 4, kickoff §4 /
// Decisión 1-A / criterio 5 (reproduce v3 §6 literalmente). El precio
// sugerido SIEMPRE es de ida; esta es una SEGUNDA cifra, declarada como
// HIPÓTESIS del regreso vacío (nunca un dato confirmado, nunca una carga real
// asumida). Solo aplica al camino de cálculo puro por RPM (≥100mi, sin tabla,
// sin tramo corto) — ver dónde se llama en resolveGenericQuote.
// ─────────────────────────────────────────────────────────────────────────────

export interface SegundaLectura {
  millasRedondo: number;
  rpmRedondo: number;
}

export function computeSegundaLectura(objetivoIda: number, millasIda: number): SegundaLectura {
  const millasRedondo = millasIda * 2;
  const rpmRedondo = Math.round((objetivoIda / millasRedondo) * 100) / 100;
  return { millasRedondo, rpmRedondo };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOPE DE SANIDAD — reglas-v3-multiestado Fase 3.
//
// El bug original ($97/mi aplicando una referencia larga a un tramo de 4
// millas) queda estructuralmente eliminado por el rediseño: ya no se escala
// ninguna tarifa plana por distancia. El riesgo residual es el espejo: un
// cálculo por RPM aplicado a una distancia declarada por el usuario que sea
// absurdamente corta o larga tampoco es defendible (RPM × 4 millas da un total
// que no cubre ni el mínimo operativo real). Estos límites reutilizan el rango
// de sanidad que ya existía para "confianza baja" en la versión anterior del
// motor, ahora como un RECHAZO duro en vez de una advertencia blanda.
// ─────────────────────────────────────────────────────────────────────────────

export const SANITY_MIN_MILES = 10;
export const SANITY_MAX_MILES = 3000;

export function dentroDelRangoDeSanidad(millasIda: number): boolean {
  return millasIda >= SANITY_MIN_MILES && millasIda <= SANITY_MAX_MILES;
}

export function buildSanityCapMarkdown(): string {
  return [
    '⚠️ Con esas millas no tengo una referencia confiable para calcular por milla.',
    'Pásame las millas exactas, o lo que le pagás al camión, y te doy un número defendible.',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// TRAMOS CORTOS — reglas-v3-multiestado Fase 4, kickoff §7 / Decisión 4 /
// criterio 13. v3 §7 arranca su tabla en ~100 millas; por debajo de eso el
// cálculo por RPM no tiene sentido económico (un tramo de 60mi a $3.01/mi da
// $180, muy por debajo de cualquier piso operativo real). La lectura crítica
// del PDF (sección E) aprueba reusar el bucket 50-100mi de los mínimos flat
// viejos como referencia de arranque — es el único bucket con la frontera de
// 100mi que pide la Decisión 4 ("el mínimo de 100mi aplica también por
// debajo"): bajo=piso, alto=objetivo (Decisión 5), fijo para cualquier
// distancia por debajo del umbral, sin escalar por RPM.
//
// Sin datos propios por equipo en v3 §7 (el documento solo da un bucket
// genérico), se aplica el mismo mínimo a cualquier equipo del camino
// genérico — documentado como simplificación deliberada, a refinar si Juan
// entrega mínimos específicos por equipo.
// ─────────────────────────────────────────────────────────────────────────────

export const SHORT_HAUL_MILES_THRESHOLD = 100;
export const SHORT_HAUL_FLOOR = 500;
export const SHORT_HAUL_TARGET = 650;

// ─────────────────────────────────────────────────────────────────────────────
// PAGO AL CAMIÓN — Decisión 9-B. (Sin cambios en esta fase respecto de la
// Fase 0; ahora sí se consume como piso — ver computeFloorTarget arriba.)
// ─────────────────────────────────────────────────────────────────────────────

export interface TruckPaymentProfile {
  pago_camion_rpm?: number | null;
}

export interface TruckPaymentDecision {
  needsAsk: boolean;
  rpm: number | null;
  shouldPersist: boolean;
}

function esRpmValido(valor: unknown): valor is number {
  return typeof valor === 'number' && isFinite(valor) && valor > 0;
}

export function resolveTruckPayment(
  profile: TruckPaymentProfile | null | undefined,
  declaradoPorUsuario: unknown,
): TruckPaymentDecision {
  const guardado = profile && esRpmValido(profile.pago_camion_rpm) ? profile.pago_camion_rpm : null;

  if (guardado != null) {
    return { needsAsk: false, rpm: guardado, shouldPersist: false };
  }

  if (esRpmValido(declaradoPorUsuario)) {
    return { needsAsk: false, rpm: declaradoPorUsuario, shouldPersist: true };
  }

  return { needsAsk: true, rpm: null, shouldPersist: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// VEREDICTO POR PERFIL — reglas-v3-multiestado Fase 6, kickoff §7.7 / spec
// "Verdict Without Dollar Minimum, By Profile".
//
// Es un veredicto DISTINTO del de `computeVerdict` (que compara la tarifa
// ofrecida contra {piso, objetivo} DE LA RUTA). Este compara la tarifa
// ofrecida contra el COSTO PROPIO del que cotiza, en bandas de PORCENTAJE de
// margen (≥40% / 25-40% / <25%) — nunca contra un piso en dólares.
//
// "Perfil" NO es un campo que se le pregunta al usuario ni que el LLM
// declara (nada de datos en manos del modelo, kickoff §1): se DERIVA
// determinísticamente de qué dato de costo tiene guardado, el mismo
// principio que ya rige pago_camion_rpm (9-B):
//   - pago_camion_rpm guardado (lo que paga a un camión subcontratado) → base "despachador"
//   - costo_por_milla guardado (su propio costo operativo, de la Calculadora) → base "owner_operator"
//   - AMBOS guardados (un carrier chico que despacha Y opera camión propio) → "carrier_pequeño":
//     se reporta el veredicto de CADA base, y se señala cuál de las dos es la
//     más restrictiva — nunca se esconde el dato menos favorable.
//   - NINGUNO guardado → sin dato de margen; no hay veredicto de perfil (no se inventa un costo).
//
// Decisión 10-B: NO hay umbral en dólares. El monto absoluto se muestra
// JUNTO al porcentaje, nunca como un corte adicional que bloquee o filtre —
// el usuario decide con los dos números delante.
// ─────────────────────────────────────────────────────────────────────────────

export type MarginBand = 'fuerte' | 'ajustado' | 'debil';

export const MARGIN_THRESHOLD_STRONG = 40;
export const MARGIN_THRESHOLD_ACCEPTABLE = 25;

export interface MarginVerdict {
  base: 'pago_camion' | 'costo_propio';
  costoBase: number;
  montoMargen: number;
  pctMargen: number;
  band: MarginBand;
  emoji: string;
  label: string;
}

/**
 * Margen = tarifa ofrecida vs. un costo base (lo que se le paga al camión, o
 * el costo propio del que cotiza). Bandas por PORCENTAJE únicamente — el
 * monto en dólares se calcula y se devuelve siempre, pero nunca decide la
 * banda por sí solo (Decisión 10-B).
 */
export function computeMarginVerdict(
  base: MarginVerdict['base'],
  tarifaOfrecida: number,
  costoBase: number,
): MarginVerdict {
  const montoMargen = Math.round(tarifaOfrecida - costoBase);
  const pctMargen = costoBase > 0
    ? Math.round(((tarifaOfrecida - costoBase) / costoBase) * 1000) / 10
    : 0;

  let band: MarginBand;
  let emoji: string;
  let label: string;
  if (pctMargen >= MARGIN_THRESHOLD_STRONG) {
    band = 'fuerte';
    emoji = '🟢';
    label = 'margen fuerte';
  } else if (pctMargen >= MARGIN_THRESHOLD_ACCEPTABLE) {
    band = 'ajustado';
    emoji = '🟡';
    label = 'margen ajustado, vale la pena comparar otras opciones';
  } else {
    band = 'debil';
    emoji = '🔴';
    label = 'margen débil frente a ese costo';
  }
  return { base, costoBase, montoMargen, pctMargen, band, emoji, label };
}

export interface ProfileMarginInput {
  tarifaOfrecida: number | null;
  millasIda: number;
  pagoCamionRpm: number | null;
  costoPorMillaPropio: number | null;
}

export type PerfilCotizador = 'despachador' | 'owner_operator' | 'carrier_pequeno' | 'sin_dato';

export interface ProfileMarginResult {
  perfil: PerfilCotizador;
  verdicts: MarginVerdict[];
  masRestrictivo: MarginVerdict | null;
}

const MARGIN_BAND_RANK: Record<MarginBand, number> = { debil: 0, ajustado: 1, fuerte: 2 };

/** El veredicto MÁS RESTRICTIVO es el de banda más baja (nunca el más optimista de los dos). */
function elMasRestrictivo(verdicts: MarginVerdict[]): MarginVerdict {
  return verdicts.reduce((peor, actual) => MARGIN_BAND_RANK[actual.band] < MARGIN_BAND_RANK[peor.band] ? actual : peor);
}

export function resolveProfileMarginVerdict(input: ProfileMarginInput): ProfileMarginResult {
  const verdicts: MarginVerdict[] = [];
  if (esRpmValido(input.tarifaOfrecida)) {
    const tarifaOfrecida = input.tarifaOfrecida as number;
    if (esRpmValido(input.pagoCamionRpm)) {
      verdicts.push(computeMarginVerdict('pago_camion', tarifaOfrecida, Math.round((input.pagoCamionRpm as number) * input.millasIda)));
    }
    if (esRpmValido(input.costoPorMillaPropio)) {
      verdicts.push(computeMarginVerdict('costo_propio', tarifaOfrecida, Math.round((input.costoPorMillaPropio as number) * input.millasIda)));
    }
  }

  if (verdicts.length === 0) {
    return { perfil: 'sin_dato', verdicts: [], masRestrictivo: null };
  }
  const perfil: PerfilCotizador = verdicts.length === 2
    ? 'carrier_pequeno'
    : verdicts[0].base === 'pago_camion' ? 'despachador' : 'owner_operator';

  return { perfil, verdicts, masRestrictivo: elMasRestrictivo(verdicts) };
}

function formatUSDSigned(n: number): string {
  return n < 0 ? `-${formatUSD(Math.abs(n))}` : formatUSD(n);
}

const MARGIN_BASE_LABEL: Record<MarginVerdict['base'], string> = {
  pago_camion: 'lo que le pagás al camión',
  costo_propio: 'tu costo propio declarado',
};

/**
 * Texto del veredicto por perfil — se agrega en `buildRateCheckMarkdown`
 * cuando hay tarifa ofrecida Y al menos un costo base declarado. Sin lenguaje
 * imperativo (criterio 16): describe la banda, nunca ordena una acción.
 */
export function buildMarginVerdictMarkdown(resultado: ProfileMarginResult): string[] {
  if (resultado.verdicts.length === 0) return [];
  const lineas = resultado.verdicts.map(v =>
    `${v.emoji} Margen vs. ${MARGIN_BASE_LABEL[v.base]}: ${formatUSDSigned(v.montoMargen)} (${v.pctMargen.toFixed(1)}%) → ${v.label}`
  );
  if (resultado.perfil === 'carrier_pequeno' && resultado.masRestrictivo) {
    lineas.push(`Entre las dos bases, la más restrictiva es "${MARGIN_BASE_LABEL[resultado.masRestrictivo.base]}" — con esa conviene comparar antes de confirmar.`);
  }
  return lineas;
}

// ─────────────────────────────────────────────────────────────────────────────
// COTIZACIÓN DE DRAYAGE — reglas-v3-multiestado Fase 3, el corazón del cambio.
//
// Orden de resolución para una consulta de drayage (equipo=drayage, con
// tamaño ya conocido):
//   1. Resolver el destino (nameResolution: alias/ZIP/ciudad tolerante).
//   2. Si resuelve a una ciudad de FL o TX → buscar en la tabla; si el tamaño
//      pedido no tiene fila propia (solo pasa en TX, que solo trae 40'
//      nativo), derivar con sizeDerivation. Con match (nativo o derivado):
//      UNA sola cifra — la tabla nunca compite con el cálculo (T-1).
//   3. Sin match de tabla (ciudad no resuelta, o estado sin tabla): calcular
//      por RPM del equipo drayage según tamaño, con las millas que dé el
//      usuario (nunca se estiman). Sin millas del usuario → se pregunta. Con
//      millas fuera del rango de sanidad → se declara y se pide el dato.
//      Se ofrecen hasta 3 rutas de referencia del mismo estado si se conoce,
//      o del estado vecino con tabla si no (Decisión 11-A).
// ─────────────────────────────────────────────────────────────────────────────

export type DrayageOutcome =
  | { kind: 'ask_miles'; ciudadConocida: string | null }
  | { kind: 'fuera_de_rango' }
  | { kind: 'quote'; calculo: CalculatedQuote };

export interface CalculatedQuote {
  estado: Estado | null;
  ciudad: string | null;
  millasIda: number;
  fuenteMillas: 'tabla' | 'usuario';
  piso: number | null;
  floorSource: FloorTargetResult['floorSource'];
  objetivo: number;
  targetSource: FloorTargetResult['targetSource'];
  dobleSupuesto: boolean;
  equipmentLabel: string;
  referencias: ReferenceRoute[];
  referenciasEstadoNombre: string | null;
  tarifaOfrecida: number | null;
  // Fase 4 — doble lectura (solo camino genérico por RPM, ≥100mi, sin tabla ni
  // tramo corto). null en cualquier otro camino, SIEMPRE null en drayage
  // (Decisión 1-A / "No Double Reading in Drayage").
  segundaLectura: SegundaLectura | null;
  // Fase 4 — drayage: de qué tabla sale la semántica de millas del match (o
  // false si no hay match de tabla, calculado por RPM de ida). Alimenta
  // buildDrayageRoundTripMarkdown (total redondo SOLO a pedido).
  precioIncluyeRegreso: boolean | null;
  // Fase 5 — accesoriales del estado consultado (o del vecino, declarado). Solo
  // se llena cuando el usuario mencionó algo (accessorial_triggers no vacío);
  // null en cualquier otro caso, incluyendo todo el camino genérico.
  accesoriales: AccessorialResolution | null;
  // Fase 6 — veredicto por perfil (margen % vs. costo propio declarado). Solo
  // se calcula cuando hay tarifaOfrecida Y al menos un costo base (pago al
  // camión u costo propio); `perfil: 'sin_dato'` con `verdicts: []` en
  // cualquier otro caso — nunca se inventa un costo para completarlo.
  perfilMargen: ProfileMarginResult;
}

function benchmarkParaTamanoDrayage(tamano: Tamano): Equipment {
  const drayage20 = EQUIPMENT_BENCHMARKS.find(e => e.id === 'drayage_20')!;
  const drayage40 = EQUIPMENT_BENCHMARKS.find(e => e.id === 'drayage_40')!;
  return tamano === '20' ? drayage20 : drayage40;
}

function nombreEstado(estado: Estado): string {
  return estado === 'FL' ? 'Florida' : 'Texas';
}

// Cuando el propio texto nombra "Florida" o "Texas" explícitamente, la ciudad
// ausente es del MISMO estado que tenemos tabla — no un vecino. Se resuelve
// aparte de NEIGHBOR_STATE_GROUPS (referenceRoutes.ts) porque esa tabla es
// específicamente de estados SIN tabla propia (la reutiliza también el
// fallback de accesoriales de la Fase 5); Florida y Texas nunca deberían
// aparecer ahí como "vecinos" de sí mismos.
function detectarEstadoPropioMencionado(texto: unknown): Estado | null {
  const t = normalizeText(texto);
  if (/(^|[^a-z])florida([^a-z]|$)/.test(t)) return 'FL';
  if (/(^|[^a-z])texas([^a-z]|$)/.test(t)) return 'TX';
  return null;
}

interface TableMatch {
  estado: Estado;
  ciudad: string;
  millasIda: number;
  piso: number | null;
  objetivo: number;
  esDerivado: boolean;
  dobleSupuesto: boolean;
  precioIncluyeRegreso: boolean;
}

function buscarEnTabla(estado: Estado, ciudad: string, tamano: Tamano): TableMatch | null {
  const directo = lookupRoute(estado, ciudad, tamano);
  if (directo) {
    return {
      estado,
      ciudad: directo.route.ciudad,
      millasIda: directo.route.millas_ida,
      piso: directo.precio.piso_tabla,
      objetivo: directo.precio.objetivo,
      esDerivado: false,
      dobleSupuesto: false,
      precioIncluyeRegreso: directo.route.semantica_millas.precio_incluye_regreso,
    };
  }

  // Solo Texas puede necesitar derivación: solo trae 40' nativo por fila.
  if (estado !== 'TX') return null;
  const nativo = lookupRoute('TX', ciudad, '40');
  if (!nativo) return null;

  const objetivoDerivado = deriveTxPrice(nativo.precio.objetivo, tamano);
  const pisoDerivado = nativo.precio.piso_tabla != null ? deriveTxPrice(nativo.precio.piso_tabla, tamano) : null;
  return {
    estado,
    ciudad: nativo.route.ciudad,
    millasIda: nativo.route.millas_ida,
    piso: pisoDerivado ? pisoDerivado.valor : null,
    objetivo: objetivoDerivado.valor,
    esDerivado: objetivoDerivado.derivado,
    dobleSupuesto: TX_SIZE_FACTORS[tamano].dobleSupuesto,
    precioIncluyeRegreso: nativo.route.semantica_millas.precio_incluye_regreso,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCESORIALES — reglas-v3-multiestado Fase 5, kickoff §7.6. Los del estado
// consultado (FL/TX propios); si el estado no tiene tabla, se heredan de un
// vecino EXPLÍCITAMENTE nombrado (mismo agrupamiento que las rutas de
// referencia, reutilizado — GA/Carolinas/AL→FL, OK/NM/LA/AR→TX). A propósito
// usa `detectNeighborState` (nunca adivina un vecino lejano) y NO
// `resolveReferenceState` (que sí cae a TX por defecto para las referencias de
// ruta) — heredar un accesorial de un estado no nombrado sería inventar una
// fuente; la lectura crítica del PDF (hallazgo B6) ya advierte que el
// fallback solo cubre 8 de ~48 estados, y los otros 40 se declaran sin dato,
// nunca con un valor por defecto silencioso.
//
// La tarifa de ruta NUNCA se hereda por esta vía — un accesorial es un cargo
// por concepto (chasis, reefer, etc.), independiente de la distancia y el
// grupo de tarifa de una ruta específica (kickoff §3.5).
// ─────────────────────────────────────────────────────────────────────────────

export interface AccessorialResolution {
  estado: Estado | null;
  heredado: boolean;
  items: AccessorialRecord[];
}

export function resolveAccessorialsForState(estadoConsultado: Estado | null, textoDestino: unknown): AccessorialResolution {
  if (estadoConsultado) {
    return { estado: estadoConsultado, heredado: false, items: loadAccessorials(estadoConsultado) };
  }
  const vecino = detectNeighborState(textoDestino);
  if (vecino) {
    return { estado: vecino, heredado: true, items: loadAccessorials(vecino) };
  }
  return { estado: null, heredado: false, items: [] };
}

/**
 * Filtra por lo que el dispatcher mencionó (`accessorial_triggers` de
 * EXTRACTION_SCHEMA) — sin triggers, no se muestra nada: no tiene sentido
 * volcar 20 líneas de accesoriales en cada respuesta de rate_check si nadie
 * preguntó por ninguno.
 */
export function filterAccessorialsByTriggers(items: AccessorialRecord[], triggers: unknown): AccessorialRecord[] {
  if (!Array.isArray(triggers) || triggers.length === 0) return [];
  const normalizados = triggers.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map(normalizeText);
  if (normalizados.length === 0) return [];
  return items.filter(item => {
    const campo = normalizeText(`${item.concepto} ${item.gatillo ?? ''}`);
    return normalizados.some(t => campo.includes(t));
  });
}

export function resolveDrayageQuote(params: {
  destinoRaw: unknown;
  tamano: Tamano;
  millasIdaDeclaradas: unknown;
  pagoCamionRpm: number | null;
  tarifaOfrecida: number | null;
  // Fase 5 — opcional: lo que el dispatcher mencionó de accesoriales
  // (`raw.accessorial_triggers`). Sin esto, `accesoriales` queda en null.
  accessorialTriggers?: unknown;
  // Fase 6 — opcional: costo propio por milla (CostConfig.costo_por_milla,
  // ya existía para la Calculadora). Sin esto, el veredicto por perfil solo
  // puede evaluar la base "despachador" (pagoCamionRpm).
  costoPorMillaPropio?: number | null;
}): DrayageOutcome {
  const { destinoRaw, tamano, millasIdaDeclaradas, pagoCamionRpm, tarifaOfrecida, accessorialTriggers, costoPorMillaPropio } = params;
  const equipmentLabel = tamano === '20' ? "Drayage/Container 20'"
    : tamano === '40' ? "Drayage/Container 40'"
    : tamano === '45' ? "Drayage/Container 45'"
    : "Drayage/Container 20' Heavy";

  const loc = resolveLocation(destinoRaw);
  const ciudadResuelta = loc.status === 'ok' ? loc.ciudad : null;
  const estadoResuelto = loc.status === 'ok' ? loc.estado : null;

  if (estadoResuelto && ciudadResuelta) {
    const match = buscarEnTabla(estadoResuelto, ciudadResuelta, tamano);
    if (match) {
      const ft = computeFloorTarget({
        tablaPiso: match.piso,
        tablaObjetivo: match.objetivo,
        targetEsDerivado: match.esDerivado,
        millasIda: match.millasIda,
        rpmBase: null,
        pagoCamionRpm,
      });
      const accesorialesMatch = resolveAccessorialsForState(match.estado, destinoRaw);
      const itemsMatch = filterAccessorialsByTriggers(accesorialesMatch.items, accessorialTriggers);
      return {
        kind: 'quote',
        calculo: {
          estado: match.estado,
          ciudad: match.ciudad,
          millasIda: match.millasIda,
          fuenteMillas: 'tabla',
          piso: ft.floor,
          floorSource: ft.floorSource,
          objetivo: ft.target,
          targetSource: ft.targetSource,
          dobleSupuesto: match.dobleSupuesto,
          equipmentLabel,
          referencias: [],
          referenciasEstadoNombre: null,
          tarifaOfrecida,
          segundaLectura: null, // drayage nunca la muestra (Decisión 1-A)
          precioIncluyeRegreso: match.precioIncluyeRegreso,
          accesoriales: itemsMatch.length > 0 ? { ...accesorialesMatch, items: itemsMatch } : null,
          perfilMargen: resolveProfileMarginVerdict({ tarifaOfrecida, millasIda: match.millasIda, pagoCamionRpm, costoPorMillaPropio: costoPorMillaPropio ?? null }),
        },
      };
    }
  }

  // Sin match de tabla: se registra para el reporte de rutas no encontradas
  // (criterio 9) — nunca bloquea la respuesta.
  if (typeof destinoRaw === 'string' && destinoRaw.trim()) {
    recordUnmatchedRoute(destinoRaw.trim(), estadoResuelto ?? 'desconocido');
  }

  const millasIda = typeof millasIdaDeclaradas === 'number' && isFinite(millasIdaDeclaradas) && millasIdaDeclaradas > 0
    ? millasIdaDeclaradas
    : null;

  if (millasIda == null) {
    return { kind: 'ask_miles', ciudadConocida: ciudadResuelta };
  }
  if (!dentroDelRangoDeSanidad(millasIda)) {
    return { kind: 'fuera_de_rango' };
  }

  const benchmark = benchmarkParaTamanoDrayage(tamano);
  const ft = computeFloorTarget({
    tablaPiso: null,
    tablaObjetivo: null,
    targetEsDerivado: false,
    millasIda,
    rpmBase: benchmark.rpm_target,
    pagoCamionRpm,
  });

  const estadoPropio = detectarEstadoPropioMencionado(destinoRaw);
  const refState = estadoPropio ? { estado: estadoPropio, cercano: true } : resolveReferenceState(destinoRaw);
  const referencias = selectReferenceRoutes(refState.estado, tamano, millasIda, ciudadResuelta);

  // Accesoriales sin match de tabla: el propio estado consultado (si se
  // conoce, aunque no tenga fila de ruta) o el vecino con tabla — NUNCA se usa
  // refState.estado a ciegas (ese sí cae a TX por defecto para referencias de
  // ruta; acá NO: un accesorial "heredado de Texas" sin nombrarlo sería
  // inventar una fuente, ver nota de resolveAccessorialsForState).
  const accesorialesCalc = resolveAccessorialsForState(estadoResuelto ?? estadoPropio, destinoRaw);
  const itemsCalc = filterAccessorialsByTriggers(accesorialesCalc.items, accessorialTriggers);

  return {
    kind: 'quote',
    calculo: {
      estado: estadoResuelto,
      ciudad: ciudadResuelta,
      millasIda,
      fuenteMillas: 'usuario',
      piso: ft.floor,
      floorSource: ft.floorSource,
      objetivo: ft.target,
      targetSource: 'calculo',
      dobleSupuesto: false,
      equipmentLabel,
      referencias,
      referenciasEstadoNombre: refState.cercano ? nombreEstado(refState.estado) : null,
      tarifaOfrecida,
      segundaLectura: null, // drayage nunca la muestra (Decisión 1-A)
      precioIncluyeRegreso: false, // cálculo por RPM de ida — sin tabla no hay "ya incluye el regreso"
      accesoriales: itemsCalc.length > 0 ? { ...accesorialesCalc, items: itemsCalc } : null,
      perfilMargen: resolveProfileMarginVerdict({ tarifaOfrecida, millasIda, pagoCamionRpm, costoPorMillaPropio: costoPorMillaPropio ?? null }),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COTIZACIÓN GENÉRICA (sin tabla) — cualquier equipo que NO sea drayage. La
// tabla de 259 rutas es solo de drayage; para dry_van/reefer/flatbed/
// step_deck/power_only siempre se calcula por RPM del equipo × millas de ida.
// Mismas reglas de piso (dato del usuario o ninguno) y tope de sanidad.
// ─────────────────────────────────────────────────────────────────────────────

export type GenericQuoteOutcome =
  | { kind: 'ask_miles' }
  | { kind: 'fuera_de_rango' }
  | { kind: 'quote'; calculo: CalculatedQuote };

export function resolveGenericQuote(params: {
  equipment: Equipment;
  millasIdaDeclaradas: unknown;
  pagoCamionRpm: number | null;
  tarifaOfrecida: number | null;
  // Fase 6 — opcional: costo propio por milla (CostConfig.costo_por_milla).
  costoPorMillaPropio?: number | null;
}): GenericQuoteOutcome {
  const { equipment, millasIdaDeclaradas, pagoCamionRpm, tarifaOfrecida, costoPorMillaPropio } = params;

  const millasIda = typeof millasIdaDeclaradas === 'number' && isFinite(millasIdaDeclaradas) && millasIdaDeclaradas > 0
    ? millasIdaDeclaradas
    : null;

  if (millasIda == null) return { kind: 'ask_miles' };
  if (!dentroDelRangoDeSanidad(millasIda)) return { kind: 'fuera_de_rango' };

  // Fase 4 — tramos cortos (v3 §7, Decisión 4): por debajo del umbral, el
  // mínimo de referencia manda sobre el cálculo por RPM (que a esa distancia
  // da cifras sin sentido económico). computeFloorTarget solo lo aplica si NO
  // hay tabla y millasIda < SHORT_HAUL_MILES_THRESHOLD — a ≥100mi este objeto
  // simplemente no se usa.
  const ft = computeFloorTarget({
    tablaPiso: null,
    tablaObjetivo: null,
    targetEsDerivado: false,
    millasIda,
    rpmBase: equipment.rpm_target,
    pagoCamionRpm,
    tramoCorto: { floor: SHORT_HAUL_FLOOR, target: SHORT_HAUL_TARGET },
  });

  // Fase 4 — segunda lectura (Decisión 1-A, criterio 5): SOLO cuando el
  // objetivo es puro cálculo por RPM (≥100mi, sin tabla ni tramo corto). El
  // tramo corto ya declara "no se asume carga de regreso" (spec) — no tiene
  // una segunda lectura por millas dobladas.
  const segundaLectura = ft.targetSource === 'calculo' ? computeSegundaLectura(ft.target, millasIda) : null;

  return {
    kind: 'quote',
    calculo: {
      estado: null,
      ciudad: null,
      millasIda,
      fuenteMillas: 'usuario',
      piso: ft.floor,
      floorSource: ft.floorSource,
      objetivo: ft.target,
      targetSource: ft.targetSource,
      dobleSupuesto: false,
      equipmentLabel: equipment.label,
      referencias: [],
      referenciasEstadoNombre: null,
      tarifaOfrecida,
      segundaLectura,
      precioIncluyeRegreso: false,
      accesoriales: null,
      perfilMargen: resolveProfileMarginVerdict({ tarifaOfrecida, millasIda, pagoCamionRpm, costoPorMillaPropio: costoPorMillaPropio ?? null }),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ARMADO DE RESPUESTAS — puro: recibe datos, devuelve texto.
// ─────────────────────────────────────────────────────────────────────────────

export function buildAskMilesMarkdown(ciudadConocida: string | null): string {
  return [
    `📊 No tengo esa ruta en mi tabla${ciudadConocida ? ` (${ciudadConocida})` : ''}, así que necesito las millas de ida para calcular.`,
    'Decime las millas y te doy el número — nunca las estimo por mi cuenta.',
  ].join('\n');
}

export function buildRateCheckMarkdown(q: CalculatedQuote): string {
  const rutaLabel = q.ciudad ? `${q.ciudad}${q.estado ? `, ${q.estado}` : ''}` : 'la ruta consultada';
  const millasTag = `~${q.millasIda} mi de ida${q.fuenteMillas === 'usuario' ? ' · dato del usuario' : ''}`;

  const targetLine = q.targetSource === 'tabla'
    ? `Objetivo de tabla: ${formatUSD(q.objetivo)}`
    : q.targetSource === 'derivado'
      ? `Objetivo derivado del 40' de tabla: ${formatUSD(q.objetivo)}${q.dobleSupuesto
        ? ' · doble supuesto: se aplica un factor estándar de industria sobre OTRO factor estándar de industria, no es tarifa de tabla'
        : ' · derivado, no es tarifa de tabla'}`
      : q.targetSource === 'tramo_corto'
        // reglas-v3-multiestado Fase 4 (v3 §7, Decisión 4): a esta distancia el
        // cálculo por RPM no es defendible; se usa el mínimo de referencia.
        ? `Objetivo de tramo corto (mínimo de referencia bajo ${SHORT_HAUL_MILES_THRESHOLD} mi): ${formatUSD(q.objetivo)}`
        : `Objetivo calculado (RPM × millas): ${formatUSD(q.objetivo)}`;

  const floorLine = q.floorSource === 'tabla'
    ? `Piso de tabla: ${formatUSD(q.piso as number)}`
    : q.floorSource === 'dato_usuario'
      ? `Piso desde tu dato (lo que le pagás al camión): ${formatUSD(q.piso as number)}`
      : q.floorSource === 'tramo_corto'
        ? `Piso de tramo corto (mínimo de referencia bajo ${SHORT_HAUL_MILES_THRESHOLD} mi): ${formatUSD(q.piso as number)} · si querés afinarlo decime tu costo por día`
        : 'Sin piso: no tengo tu costo por milla ni lo que le pagás al camión.';

  const lineas = [
    `📊 ${rutaLabel} (${millasTag}) · ${q.equipmentLabel}`,
    targetLine,
    floorLine,
  ];

  // Fase 4 — segunda lectura (Decisión 1-A, criterio 5). El precio sugerido de
  // arriba es SIEMPRE de ida; esta es una segunda cifra, HIPÓTESIS del regreso
  // vacío — nunca se presenta como el número a cobrar.
  if (q.segundaLectura) {
    lineas.push(
      `🔁 Segunda lectura — HIPÓTESIS (regreso vacío, no es un dato confirmado): si el camión vuelve vacío recorriendo las mismas millas, ese mismo pago equivale a $${q.segundaLectura.rpmRedondo.toFixed(2)}/mi sobre ${q.segundaLectura.millasRedondo} mi ida y vuelta.`,
    );
  }

  if (q.referencias.length > 0) {
    const refLabel = q.referenciasEstadoNombre
      ? `Rutas cercanas de referencia en ${q.referenciasEstadoNombre} (no es una cotización de esta ruta)`
      : 'Valores de referencia general del mercado (no es una cotización de esta ruta)';
    lineas.push(`${refLabel}:`);
    for (const r of q.referencias) {
      lineas.push(`- ${r.ciudad} (${r.millas_ida} mi): ${formatUSD(r.objetivo)}`);
    }
  }

  // Fase 5 — accesoriales del estado consultado (o del vecino, declarado).
  // Nunca se hereda la tarifa por esta vía, solo el cargo por concepto.
  if (q.accesoriales && q.accesoriales.items.length > 0) {
    const estadoAcc = q.accesoriales.estado ? nombreEstado(q.accesoriales.estado) : 'el mercado';
    const fuenteAcc = q.accesoriales.heredado
      ? `heredados de ${estadoAcc} (tu ruta no tiene tabla propia de accesoriales; la tarifa de arriba NO sale de ahí)`
      : `de ${estadoAcc}`;
    lineas.push(`Accesoriales ${fuenteAcc}:`);
    for (const a of q.accesoriales.items) {
      lineas.push(`- ${a.concepto}: ${a.monto}`);
    }
    // Fuel surcharge de Texas (Decisión 13-C): 0-62%, ya incluido en la
    // tarifa de tabla cuando la tarifa de arriba SÍ viene de esa tabla de TX
    // — nunca se suma aparte. Si los accesoriales son heredados (un vecino
    // pidió prestada la tabla de TX), la tarifa de arriba es cálculo, no
    // tabla de TX, así que esta advertencia específica no aplica.
    const trajoFuelSurcharge = q.accesoriales.items.some(a => normalizeText(a.concepto).includes('fuel surcharge'));
    if (trajoFuelSurcharge && q.accesoriales.estado === 'TX' && !q.accesoriales.heredado && q.estado === 'TX') {
      lineas.push('⚠️ El Fuel Surcharge de Texas ya está incluido en la tarifa de tabla de arriba — no se suma aparte. En la confirmación con el bróker suele presentarse por separado; conviene verificarlo ahí.');
    }
  }

  if (q.tarifaOfrecida != null) {
    const verdict = computeVerdict(q.tarifaOfrecida, q.piso, q.objetivo);
    lineas.push(`${verdict.emoji} Te ofrecen ${formatUSD(q.tarifaOfrecida)} → ${verdict.label}`);
  }

  // Fase 6 — veredicto por perfil (margen % vs. costo propio declarado,
  // Decisión 10-B: nunca un umbral en dólares, solo se muestra el monto junto
  // al porcentaje). Se agrega DESPUÉS del veredicto de piso/objetivo de
  // arriba — son dos preguntas distintas: "¿esta tarifa respeta el piso de la
  // ruta?" vs. "¿esta tarifa me deja el margen que necesito?".
  lineas.push(...buildMarginVerdictMarkdown(q.perfilMargen));

  return lineas.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// TOTAL REDONDO DE DRAYAGE, SOLO A PEDIDO — reglas-v3-multiestado Fase 4,
// Decisión 2-A / criterio 7. Por defecto la doble lectura NUNCA aparece en
// drayage; esta función solo se invoca desde entry.ts cuando
// `preguntaPorTotalRedondo` detecta que el dispatcher preguntó explícitamente.
// No hace un ×2 ciego: usa la semántica real de millas de cada tabla — FL ya
// incluye el regreso en el CT (no hay nada que sumar); TX es de ida, así que
// el total redondo es una HIPÓTESIS declarada, no un dato de tabla.
// ─────────────────────────────────────────────────────────────────────────────

const ROUND_TRIP_QUESTION_TOKENS = [
  'redondo', 'round trip', 'roundtrip', 'ida y vuelta', 'de vuelta', 'el regreso',
  'y el regreso', 'la vuelta', 'incluyendo la vuelta', 'contando la vuelta',
];

/** true si el dispatcher preguntó explícitamente por el total de ida y vuelta. Nunca adivina. */
export function preguntaPorTotalRedondo(texto: unknown): boolean {
  const normalizado = normalizeText(texto);
  if (!normalizado) return false;
  return matchesAny(normalizado, ROUND_TRIP_QUESTION_TOKENS);
}

export function buildDrayageRoundTripMarkdown(q: CalculatedQuote): string {
  const millasRedondo = q.millasIda * 2;
  if (q.precioIncluyeRegreso) {
    return [
      `🔁 La tarifa de tabla (${formatUSD(q.objetivo)}) ya incluye ida, vuelta y devolución del equipo — no hay nada que sumar.`,
      `Distancia total del movimiento: ~${millasRedondo} mi.`,
    ].join('\n');
  }
  const totalRedondo = Math.round(q.objetivo * 2);
  return [
    `🔁 Total aproximado ida y vuelta: ${formatUSD(totalRedondo)} — HIPÓTESIS: asumimos que el regreso recorre las mismas ${q.millasIda} mi; no es un dato confirmado de tabla.`,
    `Distancia total estimada: ~${millasRedondo} mi.`,
  ].join('\n');
}

export function buildGeneralMarkdown(respuestaGeneral: unknown): string {
  if (typeof respuestaGeneral !== 'string' || !respuestaGeneral.trim()) {
    return safeFallbackContent();
  }
  return respuestaGeneral.trim();
}

// Cuando no hay ciudad resuelta ni millas: pedir aclaración en vez de inventar.
export function buildMissingDataMarkdown(): string {
  return [
    '📊 Necesito más datos para calcular el piso y el objetivo.',
    'Dime origen, destino, equipo y millas (de ida) — con eso te doy el número exacto.',
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

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA DE EXTRACCIÓN — reglas-v3-multiestado, Fase 0 (modelo y frontera).
//
// Vive acá (no en entry.ts) para poder cubrirlo con `deno test`: es un objeto
// puro, sin I/O, y entry.ts no se puede importar en una prueba sin levantar el
// servidor (Deno.serve corre en el nivel superior del módulo).
// ─────────────────────────────────────────────────────────────────────────────

export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['rate_check', 'general', 'off_topic'] },
    origen: { type: 'string' },
    destino: { type: 'string' },
    millas_ida: { type: 'number' },
    es_redondo: { type: 'boolean' },
    equipo: {
      type: 'string',
      enum: ['dry_van', 'reefer', 'flatbed', 'step_deck', 'drayage', 'power_only', 'unknown'],
    },
    tamano: {
      type: 'string',
      enum: ['20', '40', '45', '20_heavy', 'unknown'],
    },
    tarifa_ofrecida: { type: 'number' },
    pago_camion: { type: 'number' },
    accessorial_triggers: {
      type: 'array',
      items: { type: 'string' },
    },
    respuesta_general: { type: 'string' },
  },
};

export type { Estado, Tamano, RouteRecord };
