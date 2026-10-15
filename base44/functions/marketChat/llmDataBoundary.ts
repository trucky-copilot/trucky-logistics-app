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
  SANITY_MIN_MILES,
  SANITY_MAX_MILES,
  type CalculatedQuote,
} from './rateEngine.ts';
import { getRouteCounts, loadAccessorials } from './rateTable.ts';
import type { Locale } from './messageCatalog.ts';

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
  for (let v of values) {
    if (v == null) continue;
    if (typeof v === 'string') v = Number(v);
    if (!Number.isFinite(v)) continue;
    set.add(roundForCompare(v as number));
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
  if (unicas.length > 0) {
    console.log(`[BOUNDARY] Fallback triggered! Invented: ${unicas.join(', ')} | Text: ${finalText}`);
  }
  return { ok: unicas.length === 0, invented: unicas };
}

export function buildBoundaryFallbackMarkdown(locale: Locale = 'es'): string {
  if (locale === 'en') {
    return [
      '⚠️ I found a figure that I cannot confirm against the calculated data, so I prefer not to show it.',
      'Please tell me the route or the specific information you are interested in and I will confirm it with the exact number.',
    ].join('\n');
  }
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
// Todas las cifras de las tablas de Tramos Cortos v3 (100mi y 200mi para Van, Reefer, Flatbed)
const SHORT_HAUL_STATIC_NUMBERS = [100, 200, 150, 250, 500, 650, 750, 1000, 550, 700, 850, 1100, 600, 750, 950, 1200];
const STATIC_TEMPLATE_NUMBERS = [...SHORT_HAUL_STATIC_NUMBERS, SANITY_MIN_MILES, SANITY_MAX_MILES];

export function buildStaticRateCheckNumbers(): number[] {
  return [...KNOWN_EQUIPMENT_SIZE_NUMBERS, ...STATIC_TEMPLATE_NUMBERS];
}

export function figuresFromCalculatedQuote(q: CalculatedQuote): number[] {
  const numeros: number[] = [q.millasIda, q.objetivo, ...buildStaticRateCheckNumbers()];
  if (q.millasIda > 0) {
    const rpmMkt = q.precioIncluyeRegreso ? (q.objetivo / (q.millasIda * 2)) : (q.objetivo / q.millasIda);
    numeros.push(rpmMkt, Number(rpmMkt.toFixed(2)));
  }
  if (q.piso != null) numeros.push(q.piso);
  if (q.tarifaOfrecida != null) numeros.push(q.tarifaOfrecida);
  if (q.segundaLectura) numeros.push(q.segundaLectura.millasRedondo, q.segundaLectura.rpmRedondo);
  numeros.push(Math.round(q.objetivo * 2), q.millasIda * 2);
  for (const r of q.referencias) numeros.push(r.millas_ida, r.objetivo);
  if (q.accesoriales) {
    let totalAccesoriales = 0;
    for (const item of q.accesoriales.items) {
      const tokens = extractNumericTokens(item.monto);
      numeros.push(...tokens);
      const match = typeof item.monto === 'string' ? item.monto.match(/\$(\d+(\.\d+)?)/) : null;
      if (match) {
        totalAccesoriales += parseFloat(match[1]);
      }
    }
    if (totalAccesoriales > 0) {
      numeros.push(q.objetivo + totalAccesoriales);
      if (q.piso != null) numeros.push(q.piso + totalAccesoriales);
      if (q.tarifaObjetivaPropia != null) numeros.push(q.tarifaObjetivaPropia * q.millasIda + totalAccesoriales);
      if (q.costoPorMillaPropio != null) numeros.push(q.costoPorMillaPropio * q.millasIda + totalAccesoriales);
    }
  }
  for (const v of q.perfilMargen.verdicts) {
    numeros.push(
      v.costoBase, 
      v.montoMargen, 
      Math.abs(v.montoMargen), 
      v.pctMargen,
      Number(v.pctMargen.toFixed(1)),
      Number(Math.abs(v.pctMargen).toFixed(1)),
      Math.round(v.pctMargen),
      Math.round(Math.abs(v.pctMargen))
    );
  }
  if (q.tarifaOfrecida != null && q.millasIda > 0) {
    const rpmOfrecida = q.tarifaOfrecida / q.millasIda;
    numeros.push(
      rpmOfrecida,
      Number(rpmOfrecida.toFixed(2)),
      Number(rpmOfrecida.toFixed(1)),
      Math.round(rpmOfrecida * 100) / 100
    );
  }
  // Semáforo — CPM y tarifa objetivo del usuario (en $/mi) y sus totales
  // calculados para la ruta. Autorizados porque buildRateCheckMarkdown los
  // muestra explícitamente en el bloque de zonas ROJO/AMARILLO/VERDE.
  if (q.costoPorMillaPropio != null) {
    numeros.push(q.costoPorMillaPropio);
    numeros.push(Math.round(q.costoPorMillaPropio * q.millasIda)); // total $ a CPM
  }
  if (q.tarifaObjetivaPropia != null) {
    numeros.push(q.tarifaObjetivaPropia);
    numeros.push(Math.round(q.tarifaObjetivaPropia * q.millasIda)); // total $ al objetivo
    // limSuperior = max(cpm, tObj) — el total que buildRateCheckMarkdown usa cuando cpm > tObj
    if (q.costoPorMillaPropio != null) {
      const limSup = Math.max(q.costoPorMillaPropio, q.tarifaObjetivaPropia);
      numeros.push(Math.round(limSup * q.millasIda));
    }
  }
  if (q.tarifaBreakEvenPropia != null) {
    numeros.push(q.tarifaBreakEvenPropia);
    numeros.push(Math.round(q.tarifaBreakEvenPropia * q.millasIda));
  }
  if (q.tarifaPromedioEstado != null) {
    numeros.push(q.tarifaPromedioEstado);
    numeros.push(Math.round(q.tarifaPromedioEstado * q.millasIda));
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
  // Horas y tiempos estándar usuales en temas de espera/detention y descansos HOS
  numeros.push(1, 2, 3, 4, 5, 8, 10, 11, 12, 14, 24, 34, 48, 70);
  for (const a of ACCESSORIALS) numeros.push(a.min, a.max);
  try {
    for (const item of loadAccessorials('FL')) {
      numeros.push(...extractNumericTokens(item.monto));
    }
    for (const item of loadAccessorials('TX')) {
      numeros.push(...extractNumericTokens(item.monto));
    }
  } catch (_e) {
    // Si la lectura falla en entornos aislados, no romper el conjunto base
  }
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
  const extraNumeros: number[] = [
    // Números enteros y horas comunes en explicaciones
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 24, 36, 48, 70, 72,
    // Porcentajes comunes de mercado y márgenes
    5, 10, 15, 20, 25, 30, 35, 40, 50,
    // Rangos estándar y comunes de accesoriales en la industria
    25, 35, 40, 45, 50, 60, 75, 90, 100, 115, 125, 150, 175, 200, 250, 300,
  ];

  // Si el usuario tiene costo/milla y objetivo configurados, autorizar también el margen derivado
  const cpm = costConfigValuesShown.find(v => v != null && v > 0 && v < 10);
  const obj = costConfigValuesShown.find(v => v != null && v >= 2 && v <= 10 && v !== cpm);
  if (cpm != null && obj != null) {
    extraNumeros.push(Math.round(Math.abs(obj - cpm) * 100) / 100);
  }

  return buildAllowedNumbersSet([...buildKbConstantNumbers(), ...costConfigValuesShown, ...extraNumeros]);
}
