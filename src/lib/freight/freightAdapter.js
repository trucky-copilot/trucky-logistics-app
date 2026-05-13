/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FREIGHT ADAPTER — Capa de Consumo y Versión Runtime
 * ═══════════════════════════════════════════════════════════════════════════
 * Propósito:
 *   - Traducir la KB maestra al formato que necesita cada parte de la app.
 *   - Proveer versión ligera (runtime) para consultas frecuentes.
 *   - Aislar UI/agentes/backend de cambios en la estructura de la KB.
 *   - Proveer fallbacks seguros si una sección no existe.
 *
 * REGLA: Nunca importar FREIGHT_KB directamente en componentes.
 *        Siempre usar las funciones de este adaptador.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { FREIGHT_KB, KB_VALID, FREIGHT_KB_VERSION } from '@/lib/freight/freightKnowledgeBase.js';

// ─── HELPERS INTERNOS ─────────────────────────────────────────────────────────
const safe = (fn, fallback = null) => {
  try { return fn(); } catch { return fallback; }
};

const safeArray = (fn) => safe(fn, []);
const safeObj   = (fn) => safe(fn, {});

// ─── A. RUNTIME SNAPSHOT (versión ligera para uso frecuente) ──────────────────
export function getRuntimeSnapshot() {
  return {
    version:          FREIGHT_KB_VERSION,
    valid:            KB_VALID,
    rpm_benchmarks:   safeArray(() => FREIGHT_KB.rpm_benchmarks),
    flat_rate_rule:   safe(() => FREIGHT_KB.flat_rate_rule, ''),
    deadhead:         safeObj(() => FREIGHT_KB.deadhead_rules),
    decision:         safeObj(() => FREIGHT_KB.decision_criteria),
    accessorials_rule: safe(() => FREIGHT_KB.accessorials_rule, ''),
    lane_targets:     safeObj(() => FREIGHT_KB.lane_analysis?.target_net_per_hour),
  };
}

// ─── B. LOAD TYPES ────────────────────────────────────────────────────────────
export function getLoadTypes() {
  return safeArray(() => FREIGHT_KB.load_types);
}

export function getLoadTypeById(id) {
  const types = getLoadTypes();
  return types.find(t => t.id === id) || null;
}

export function getRpmBenchmarks() {
  return safeArray(() => FREIGHT_KB.rpm_benchmarks);
}

export function getRpmForEquipment(equipmentLabel) {
  const benchmarks = getRpmBenchmarks();
  const match = benchmarks.find(b =>
    b.equipment.toLowerCase().includes(equipmentLabel.toLowerCase())
  );
  return match || null;
}

// ─── C. CÁLCULOS ──────────────────────────────────────────────────────────────
export function getCalculations() {
  return safeObj(() => FREIGHT_KB.calculations);
}

export function getFlatRateMinimums() {
  return safeArray(() => FREIGHT_KB.flat_rate_minimums);
}

export function getFlatRateForMiles(miles) {
  const ranges = getFlatRateMinimums();
  if (!ranges.length) return null;

  if (miles < 50)         return ranges[0];
  if (miles < 100)        return ranges[1];
  if (miles < 200)        return ranges[2];
  if (miles < 400)        return ranges[3];
  if (miles < 600)        return ranges[4];
  if (miles < 800)        return ranges[5];
  return ranges[6] || ranges[ranges.length - 1];
}

export function getDeadheadRules() {
  return safeObj(() => FREIGHT_KB.deadhead_rules);
}

/**
 * Evalúa el nivel de deadhead dado un porcentaje.
 * @returns {{ level: 'acceptable'|'concerning'|'deal_breaker', label: string, color: string }}
 */
export function evaluateDeadhead(deadheadMiles, loadedMiles) {
  if (!loadedMiles || loadedMiles <= 0) return { level: 'unknown', label: 'Sin datos', color: 'gray' };
  const pct = (deadheadMiles / loadedMiles) * 100;
  const rules = getDeadheadRules();

  if (pct <= (rules.acceptable?.threshold_pct ?? 20))   return { ...rules.acceptable,   pct };
  if (pct <= (rules.concerning?.threshold_pct ?? 40))   return { ...rules.concerning,   pct };
  return { ...rules.deal_breaker, pct };
}

// ─── D. ANÁLISIS DE CARGA ─────────────────────────────────────────────────────
/**
 * Calcula el veredicto de una carga.
 * @param {{ offeredRate: number, totalMiles: number, cpm: number }} params
 * @returns {{ verdict: 'take_it'|'negotiate'|'decline', label: string, color: string, emoji: string, rpm: number, profit_per_mile: number }}
 */
export function analyzeLoadVerdict({ offeredRate, totalMiles, cpm }) {
  const defaults = {
    verdict: 'negotiate', label: 'NEGOCIAR', color: 'yellow', emoji: '⚠️', rpm: 0, profit_per_mile: 0,
  };

  if (!offeredRate || !totalMiles || totalMiles <= 0) return defaults;

  const rpm = offeredRate / totalMiles;
  const profit_per_mile = cpm ? rpm - cpm : 0;
  const criteria = safeObj(() => FREIGHT_KB.decision_criteria);

  let verdict, label, color, emoji;

  if (cpm && rpm < cpm) {
    verdict = 'decline';   label = criteria.decline?.label   || 'RECHAZAR'; color = 'red';    emoji = '🚫';
  } else if (cpm && profit_per_mile >= 0.50) {
    verdict = 'take_it';   label = criteria.take_it?.label   || 'TOMAR';    color = 'green';  emoji = '✅';
  } else {
    verdict = 'negotiate'; label = criteria.negotiate?.label || 'NEGOCIAR'; color = 'yellow'; emoji = '⚠️';
  }

  return { verdict, label, color, emoji, rpm: +rpm.toFixed(3), profit_per_mile: +profit_per_mile.toFixed(3) };
}

// ─── E. ACCESSORIALS ─────────────────────────────────────────────────────────
export function getAccessorials() {
  return safeArray(() => FREIGHT_KB.accessorials);
}

// ─── F. REGULACIONES ─────────────────────────────────────────────────────────
export function getRegulations() {
  return safeObj(() => FREIGHT_KB.regulations);
}

export function getHosRules() {
  return safeObj(() => FREIGHT_KB.regulations?.hos);
}

export function getWeightLimits() {
  return safeObj(() => FREIGHT_KB.regulations?.weight_limits);
}

export function getHazmatClasses() {
  return safeArray(() => FREIGHT_KB.regulations?.hazmat?.classes);
}

// ─── G. RED FLAGS ──────────────────────────────────────────────────────────────
export function getRedFlags() {
  return safeObj(() => FREIGHT_KB.red_flags);
}

export function getAutoDeclines() {
  return safeArray(() => FREIGHT_KB.red_flags?.auto_decline);
}

export function getCautionFlags() {
  return safeArray(() => FREIGHT_KB.red_flags?.proceed_with_caution);
}

// ─── H. ESCENARIOS ────────────────────────────────────────────────────────────
export function getScenarios() {
  return safeArray(() => FREIGHT_KB.scenarios);
}

export function getScenarioById(id) {
  return getScenarios().find(s => s.id === id) || null;
}

export function getScenarioTemplate(id) {
  const scenario = getScenarioById(id);
  return scenario?.template || null;
}

// ─── I. LANE ANALYSIS ─────────────────────────────────────────────────────────
export function getLaneAnalysis() {
  return safeObj(() => FREIGHT_KB.lane_analysis);
}

// ─── J. CARRIER PROFILE FIELDS ────────────────────────────────────────────────
export function getCarrierProfileFields() {
  return safeArray(() => FREIGHT_KB.carrier_profile_fields);
}

// ─── K. COMMUNICATION TEMPLATES ───────────────────────────────────────────────
export function getCommunicationTemplates() {
  return safeObj(() => FREIGHT_KB.communication_templates);
}

// ─── L. PROMPT COMPLETO PARA AGENTES IA ──────────────────────────────────────
/**
 * Genera el prompt de sistema para agentes IA o funciones de backend.
 * Usa la KB como fuente de verdad — nunca texto hardcoded en agentes.
 */
export function buildAgentSystemPrompt(carrierContext = {}) {
  const kb = FREIGHT_KB;
  const snap = getRuntimeSnapshot();

  const rpmTable = snap.rpm_benchmarks
    .map(b => `  - ${b.equipment}: Mín $${b.min}/mi | Bueno $${b.good}/mi | Excelente $${b.excellent}+/mi`)
    .join('\n');

  const flatRates = safeArray(() => kb.flat_rate_minimums)
    .map(r => `  - ${r.range}: $${r.min}–${r.max ?? r.min + '+'}`)
    .join('\n');

  const redFlagsAuto = safeArray(() => kb.red_flags?.auto_decline)
    .map(f => `  - ${f}`).join('\n');

  const accessorials = safeArray(() => kb.accessorials)
    .map(a => `  - ${a.service}: $${a.min ?? ''}${a.max && a.max !== a.min ? `–${a.max}` : ''}${a.unit}`)
    .join('\n');

  const carrierInfo = Object.keys(carrierContext).length
    ? `\n## Contexto del Carrier\n${JSON.stringify(carrierContext, null, 2)}\n`
    : '';

  return `Eres un dispatcher profesional de carga en EE.UU. Ayudas a carriers, owner-operators y pequeñas empresas de transporte a tomar decisiones inteligentes.

${carrierInfo}
## Benchmarks RPM (2024–2025)
${rpmTable}

## Mínimos Flat Rate
${flatRates}
Regla: ${snap.flat_rate_rule}

## Deadhead
- Aceptable: < 20% de millas cargadas
- Preocupante: 20–40%
- Deal-breaker: > 40% (salvo que la tarifa lo compense)
- Si deadhead > 100 mi: pedir $1.00–$1.50/mi adicional

## Accessorials
${accessorials}
Regla: ${snap.accessorials_rule}

## Veredicto de Carga
- ✅ TOMAR: RPM muy por encima del CPM, ruta buena, sin red flags
- ⚠️ NEGOCIAR: Tarifa cerca del mínimo
- 🚫 RECHAZAR: Tarifa bajo CPM, exceso deadhead, problemas operativos

## Flags de Rechazo Automático
${redFlagsAuto}

## Fórmulas Clave
- CPM = Costos fijos semanales ÷ Millas semanales
- RPM = Tarifa total ÷ Millas totales (cargadas + vacías)
- Ingreso neto/hora objetivo: $40–$60 para owner-operators

## Comunicación
- Responder RFQs dentro de 5–10 minutos
- Ser directo: primero la tarifa y disponibilidad
- Contraoferta: nunca pedir disculpas por tu tarifa
- Siempre dejar puerta abierta al declinar

Versión KB: ${FREIGHT_KB_VERSION}`;
}