// ─────────────────────────────────────────────────────────────────────────────
// COSTO POR MILLA — fuente única de verdad del costo por milla y la tarifa de
// break-even. La importan Onboarding.jsx, CostCalculator.jsx (vía el alias
// `@/lib/freight/costMath`) y tests/costMath.test.ts (vía ruta relativa).
//
// RESTRICCIÓN DURA: este módulo NO puede tener imports.
//   - `deno test` no tiene `deno.json` ni import map en este repo, así que no
//     hay forma de resolver el alias `@/...` que usa Vite (jsconfig.json) — un
//     solo import con `@/` rompería la corrida de `deno test`.
//   - Tampoco puede usar specifiers `npm:` ni JSX ni nada del DOM: nada de eso
//     resuelve igual bajo Deno que bajo Vite.
//   - Por eso el módulo se queda puro y sin imports; los callers de React sí
//     pueden usar el alias normalmente.
//
// Antes de este módulo, Onboarding.jsx tenía su propio cálculo (calcBreakEven,
// con un costo fijo hardcodeado de $0.45/mi) y CostCalculator.jsx tenía otro
// cálculo inline — los dos podían (y de hecho ya divergían) dar números
// distintos para el mismo concepto. Este módulo es la única fórmula.
// ─────────────────────────────────────────────────────────────────────────────

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Estimación de costos fijos usada cuando el usuario todavía no los capturó.
 * Coincide con los defaults del schema de CostConfig y con el estado inicial
 * de la Calculadora, para que ambos lados muestren el mismo número.
 */
export const FIXED_COST_DEFAULTS = {
  seguro_semanal: 800,
  lease_semanal: 1200,
  otros_gastos_semanales: 300,
  millas_semana_promedio: 2500,
};

/**
 * Costo fijo por milla: (seguro + lease + otros) / millas de la semana.
 * Da NaN (nunca Infinity) si millas_semana_promedio no es positivo — antes,
 * dividir entre 0 millas producía Infinity sin que nadie lo detectara.
 */
export function fixedCostPerMile(i) {
  const semanal = num(i.seguro_semanal) + num(i.lease_semanal) + num(i.otros_gastos_semanales);
  const millas = num(i.millas_semana_promedio);
  return millas > 0 ? semanal / millas : NaN;
}

/**
 * Costo de diésel por milla: diesel_precio / mpg.
 * Da NaN (nunca Infinity) si mpg no es positivo.
 */
export function fuelCostPerMile(i) {
  const mpg = num(i.mpg);
  return mpg > 0 ? num(i.diesel_precio) / mpg : NaN;
}

/** Nombre del campo a mostrarle al usuario cuando falta o es inválido. */
export const CAMPO_LABEL = {
  mpg: 'MPG del camión',
  diesel_precio: 'Precio del diésel',
  millas_semana_promedio: 'Millas/semana promedio',
  pago_conductor_porcentaje: '% pago conductor',
};

/**
 * Deriva costo/milla y tarifa de break-even a partir de los inputs de costo.
 *
 * `valido` es la única señal que el caller debe consultar antes de mostrar o
 * guardar los números derivados: si es `false`, ni costoPorMilla ni
 * tarifaBreakEven deben llegar a pantalla ni a un registro guardado — se
 * muestra "sin calcular"/"—" y `faltante` nombra el primer campo responsable.
 *
 * @returns {{ costoPorMilla: number, tarifaBreakEven: number, valido: boolean, faltante: string|null }}
 */
export function deriveCosts(i) {
  const fuel = fuelCostPerMile(i);
  const fijo = fixedCostPerMile(i);
  const share = num(i.pago_conductor_porcentaje) / 100; // % de la tarifa, no un costo
  const costoPorMilla = fuel + fijo;
  const tarifaBreakEven = costoPorMilla / (1 - share);

  const faltante = !(num(i.mpg) > 0)
    ? 'mpg'
    // Antes: un ternario silencioso ponía el costo fijo en 0 cuando
    // millas_semana_promedio era 0 — cambio deliberado: ahora es inválido y
    // se nombra, porque un costo fijo en $0 es una mentira, no un default.
    : !(num(i.millas_semana_promedio) > 0)
      ? 'millas_semana_promedio'
      : !(share >= 0 && share < 1)
        ? 'pago_conductor_porcentaje'
        : !(Number.isFinite(costoPorMilla) && Number.isFinite(tarifaBreakEven))
          ? 'diesel_precio'
          : null;

  return { costoPorMilla, tarifaBreakEven, valido: faltante === null, faltante };
}
