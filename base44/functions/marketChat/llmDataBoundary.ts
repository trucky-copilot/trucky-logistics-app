// ─────────────────────────────────────────────────────────────────────────────
// FRONTERA LLM / DATOS — dominio puro, reglas-v3-multiestado Fase 7 (kickoff
// §1 / §8-IN / criterio de éxito 4, riesgo 3).
//
// "Nada de datos queda en manos del modelo. El LLM solo arma respuestas; las
// cifras salen del JSON y del código." Ese principio ya regía por INSTRUCCIÓN
// de prompt (BASE_CONTEXT en entry.ts: "NUNCA inventes cifras..."), pero una
// instrucción de prompt no es una garantía — un redactor al que se le pide
// "explica el cálculo" tiende a recalcular y redondear (kickoff riesgo 3).
// Por eso el criterio 4 exige verificación AUTOMÁTICA, no solo una regla en
// el prompt.
//
// Este módulo es el validador: escanea el TEXTO FINAL que se le va a devolver
// al usuario, extrae toda cifra numérica presente, y la compara contra el
// conjunto de cifras autorizadas para esa respuesta:
//   - rate_check (y cualquier respuesta con un CalculatedQuote): el conjunto
//     autorizado es EXACTAMENTE lo que hay en el bloque calculado — ninguna
//     otra cifra puede colarse, ni siquiera una "casi igual".
//   - general (respuesta libre del LLM): el conjunto autorizado son las
//     constantes de la KB (RPM base por equipo, detention, accessorials, HOS,
//     deadhead, conteo de rutas, umbrales de margen) más los valores de
//     CostConfig que efectivamente se le mostraron al modelo ese turno.
//
// Si aparece una cifra fuera de ese conjunto, la respuesta se BLOQUEA — nunca
// se envía cruda — y se reemplaza por un mensaje que declara la incertidumbre
// en vez de inventar. Wireado en entry.ts, antes de CADA `Response.json`, sin
// excepción (no es opcional).
//
// REGLA: acá no entra nada que haga red, lea entidades ni invoque al LLM —
// mismo principio de pureza que el resto de los módulos de dominio.
// ─────────────────────────────────────────────────────────────────────────────

import {
  EQUIPMENT_BENCHMARKS,
  DETENTION,
  ACCESSORIALS,
  HOS_LIMITS,
  DEADHEAD_THRESHOLDS,
  MARGIN_THRESHOLD_STRONG,
  MARGIN_THRESHOLD_ACCEPTABLE,
  SHORT_HAUL_MILES_THRESHOLD,
  SANITY_MIN_MILES,
  SANITY_MAX_MILES,
  type CalculatedQuote,
} from './rateEngine.ts';
import { getRouteCounts } from './rateTable.ts';

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACCIÓN DE CIFRAS
// ─────────────────────────────────────────────────────────────────────────────

// Cubre enteros, miles con coma ("1,264"), decimales ("3.01"), y porcentajes
// ("40%" → el "%" queda fuera del match, se captura el número solo). No
// distingue signo negativo a propósito: si el redactor pone "-180" o "180" es
// la misma cifra para efectos de este chequeo (el signo no cambia si el
// número está o no autorizado).
const NUMERIC_TOKEN_RE = /\d[\d,]*(?:\.\d+)?/g;

export function extractNumericTokens(text: unknown): number[] {
  if (typeof text !== 'string' || !text) return [];
  const matches = text.match(NUMERIC_TOKEN_RE) || [];
  return matches
    .map(m => Number(m.replace(/,/g, '')))
    .filter(n => Number.isFinite(n));
}

// Tolerancia mínima para absorber ruido de PUNTO FLOTANTE puro (p. ej.
// 0.1 + 0.2 !== 0.3) entre distintos pasos de formateo — nunca para disimular
// una cifra realmente distinta. Una diferencia real de un centavo (0.01) YA
// ES una cifra distinta y debe fallar; por eso la tolerancia es un orden de
// magnitud menor que un centavo.
const COMPARE_TOLERANCE = 0.0005;

function roundForCompare(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildAllowedNumbersSet(values: Array<number | null | undefined>): Set<number> {
  const set = new Set<number>();
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    set.add(roundForCompare(v));
  }
  return set;
}

export interface BoundaryCheckResult {
  ok: boolean;
  invented: number[];
}

/**
 * Verifica que TODA cifra numérica en `finalText` esté en `allowedNumbers`.
 * Cualquier cifra que no matchee (ni siquiera con la tolerancia de redondeo)
 * es "inventada" y hace fallar el chequeo — criterio de éxito 4.
 */
export function assertNoInventedFigures(finalText: unknown, allowedNumbers: Set<number>): BoundaryCheckResult {
  const encontradas = extractNumericTokens(finalText);
  const permitidas = Array.from(allowedNumbers);
  const inventadas = encontradas.filter(n => {
    const r = roundForCompare(n);
    return !permitidas.some(p => Math.abs(p - r) <= COMPARE_TOLERANCE);
  });
  const unicas = Array.from(new Set(inventadas));
  return { ok: unicas.length === 0, invented: unicas };
}

export function buildBoundaryFallbackMarkdown(): string {
  return [
    '⚠️ Encontré una cifra que no puedo confirmar contra los datos calculados, así que prefiero no mostrarla.',
    'Decime la ruta o el dato puntual que te interesa y te la confirmo con el número exacto.',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CONJUNTO AUTORIZADO — RATE_CHECK (bloque calculado)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Todas las cifras que legítimamente pueden aparecer en la respuesta de un
 * rate_check: las del propio `CalculatedQuote` — piso, objetivo, millas,
 * tarifa ofrecida, segunda lectura, rutas de referencia, accesoriales (su
 * `monto` es una cadena con la cifra embebida, p. ej. "$100 · por
 * contenedor") y el veredicto por perfil (Fase 6).
 */
// Tamaños de contenedor/equipo (20', 40', 45', 53') — un enum fijo de CÓDIGO
// (sizeDerivation.ts / EQUIPMENT_BENCHMARKS), nunca un dato que el LLM podría
// inventar. `buildRateCheckMarkdown` a veces nombra el 40' NATIVO de Texas
// aunque el tamaño pedido sea otro (p. ej. "Objetivo derivado del 40' de
// tabla" al cotizar un 45') — ese "40" no sale del propio `CalculatedQuote`
// (que describe el tamaño PEDIDO, no el nativo de la derivación), así que se
// autoriza como constante de dominio en vez de intentar rastrear cada
// literal de plantilla.
const KNOWN_EQUIPMENT_SIZE_NUMBERS = [20, 40, 45, 53];

// Constantes de código que aparecen en plantillas fijas de
// `buildRateCheckMarkdown` independientemente del `CalculatedQuote` puntual
// (p. ej. "Objetivo de tramo corto (mínimo de referencia bajo 100 mi)").
const STATIC_TEMPLATE_NUMBERS = [SHORT_HAUL_MILES_THRESHOLD, SANITY_MIN_MILES, SANITY_MAX_MILES];

export function figuresFromCalculatedQuote(q: CalculatedQuote): number[] {
  const numeros: number[] = [q.millasIda, q.objetivo, ...KNOWN_EQUIPMENT_SIZE_NUMBERS, ...STATIC_TEMPLATE_NUMBERS];
  if (q.piso != null) numeros.push(q.piso);
  if (q.tarifaOfrecida != null) numeros.push(q.tarifaOfrecida);
  if (q.segundaLectura) numeros.push(q.segundaLectura.millasRedondo, q.segundaLectura.rpmRedondo);
  // El total redondo de drayage a pedido (buildDrayageRoundTripMarkdown) no
  // está en CalculatedQuote como campo propio — se deriva de objetivo/millas
  // ya incluidos arriba (objetivo×2 y millasIda×2), así que no hace falta un
  // campo aparte para que el chequeo lo reconozca.
  numeros.push(Math.round(q.objetivo * 2), q.millasIda * 2);
  for (const r of q.referencias) numeros.push(r.millas_ida, r.objetivo);
  if (q.accesoriales) {
    for (const item of q.accesoriales.items) {
      numeros.push(...extractNumericTokens(item.monto));
    }
  }
  for (const v of q.perfilMargen.verdicts) {
    numeros.push(v.costoBase, v.montoMargen, Math.abs(v.montoMargen), v.pctMargen);
  }
  return numeros;
}

export function buildRateCheckAllowedNumbers(q: CalculatedQuote): Set<number> {
  return buildAllowedNumbersSet(figuresFromCalculatedQuote(q));
}

// ─────────────────────────────────────────────────────────────────────────────
// CONJUNTO AUTORIZADO — GENERAL (constantes de KB + CostConfig del turno)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cifras de la KB estática que el LLM puede legítimamente repetir en una
 * respuesta "general" (p. ej. "¿cuánto es el RPM de reefer?", "¿cuántas
 * horas puedo manejar?"). Cierra la brecha que documentó la exploración de
 * diseño: hasta esta fase, "general" no tenía ninguna verificación
 * automática, solo la instrucción de prompt.
 */
export function buildKbConstantNumbers(): number[] {
  const numeros: number[] = [];
  for (const e of EQUIPMENT_BENCHMARKS) numeros.push(e.rpm_min, e.rpm_target);
  numeros.push(DETENTION.standard, DETENTION.min, DETENTION.max, DETENTION.free_hours);
  for (const a of ACCESSORIALS) numeros.push(a.min, a.max);
  numeros.push(
    HOS_LIMITS.driving_hours,
    HOS_LIMITS.on_duty_hours,
    HOS_LIMITS.break_minutes,
    HOS_LIMITS.break_after_hours,
    HOS_LIMITS.hours_8_days,
    HOS_LIMITS.hours_7_days,
  );
  numeros.push(
    DEADHEAD_THRESHOLDS.ok_pct,
    DEADHEAD_THRESHOLDS.concerning_pct,
    DEADHEAD_THRESHOLDS.long_deadhead_miles,
    DEADHEAD_THRESHOLDS.extra_rpm_min,
    DEADHEAD_THRESHOLDS.extra_rpm_max,
  );
  numeros.push(MARGIN_THRESHOLD_STRONG, MARGIN_THRESHOLD_ACCEPTABLE);
  const counts = getRouteCounts();
  numeros.push(counts.fl, counts.tx, counts.total);
  return numeros;
}

/**
 * `costConfigValuesShown` son los valores DINÁMICOS de CostConfig que
 * entry.ts efectivamente interpoló en el prompt de este turno (diésel, mpg,
 * costo/milla, break-even, objetivo) — el LLM puede repetirlos porque son
 * dato real mostrado, no una cifra inventada.
 */
export function buildGeneralIntentAllowedNumbers(costConfigValuesShown: Array<number | null | undefined> = []): Set<number> {
  return buildAllowedNumbersSet([...buildKbConstantNumbers(), ...costConfigValuesShown]);
}
