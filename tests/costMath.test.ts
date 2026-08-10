// ─────────────────────────────────────────────────────────────────────────────
// Pruebas del módulo de costo por milla compartido por Onboarding.jsx y
// CostCalculator.jsx.
//
// Cubren las funciones puras de src/lib/freight/costMath.js. El módulo importa
// por ruta relativa (no por el alias `@/`) precisamente para que esta prueba
// pueda correr bajo `deno test` sin levantar Vite ni resolver el alias — ver
// el comentario de restricción al inicio de costMath.js.
//
// Correr con:  npm run test:functions  (o deno test --allow-read tests/)
// ─────────────────────────────────────────────────────────────────────────────

import { assertEquals, assert } from 'jsr:@std/assert@1';

import {
  FIXED_COST_DEFAULTS,
  fuelCostPerMile,
  fixedCostPerMile,
  deriveCosts,
  CAMPO_LABEL,
} from '../src/lib/freight/costMath.js';

// ─────────────────────────────────────────────────────────────────────────────
// FÓRMULAS BÁSICAS Y GUARDS — evitar Infinity por división entre cero.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('costos: fuelCostPerMile es diesel_precio / mpg', () => {
  assertEquals(fuelCostPerMile({ diesel_precio: 5.4, mpg: 6.75 }), 5.4 / 6.75);
});

Deno.test('costos: fuelCostPerMile da NaN (nunca Infinity) cuando mpg es 0 o negativo', () => {
  assert(Number.isNaN(fuelCostPerMile({ diesel_precio: 5.4, mpg: 0 })));
  assert(Number.isNaN(fuelCostPerMile({ diesel_precio: 5.4, mpg: -1 })));
  assert(Number.isNaN(fuelCostPerMile({ diesel_precio: 5.4, mpg: null })));
});

Deno.test('costos: fixedCostPerMile es (seguro+lease+otros) / millas_semana', () => {
  const r = fixedCostPerMile(FIXED_COST_DEFAULTS);
  assertEquals(r, (800 + 1200 + 300) / 2500);
  assertEquals(r, 0.92);
});

Deno.test('costos: fixedCostPerMile da NaN (nunca Infinity) cuando millas_semana_promedio es 0 o negativo', () => {
  assert(Number.isNaN(fixedCostPerMile({ ...FIXED_COST_DEFAULTS, millas_semana_promedio: 0 })));
  assert(Number.isNaN(fixedCostPerMile({ ...FIXED_COST_DEFAULTS, millas_semana_promedio: -100 })));
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveCosts — valido/faltante son la única señal que debe consultar el
// caller. Ningún Infinity debe llegar nunca a los valores derivados.
// ─────────────────────────────────────────────────────────────────────────────

const VALID_INPUT = {
  diesel_precio: 5.4,
  mpg: 6.5,
  pago_conductor_porcentaje: 25,
  ...FIXED_COST_DEFAULTS,
};

Deno.test('costos: deriveCosts con datos completos es válido y finito', () => {
  const r = deriveCosts(VALID_INPUT);
  assertEquals(r.valido, true);
  assertEquals(r.faltante, null);
  assert(Number.isFinite(r.costoPorMilla));
  assert(Number.isFinite(r.tarifaBreakEven));
});

Deno.test('costos: MPG vacío o 0 es inválido, nombra el campo y nunca da Infinity', () => {
  for (const mpg of [0, null, undefined, '']) {
    const r = deriveCosts({ ...VALID_INPUT, mpg });
    assertEquals(r.valido, false);
    assertEquals(r.faltante, 'mpg');
    assertEquals(r.costoPorMilla === Infinity, false);
    assertEquals(r.tarifaBreakEven === Infinity, false);
  }
});

// Cambio deliberado vs. el ternario silencioso de hoy (CostCalculator.jsx:42),
// que pone el costo fijo en 0 cuando millas_semana_promedio es 0. Un costo
// fijo en $0 es una mentira, no un default — ahora se nombra como inválido.
Deno.test('costos: millas_semana_promedio <= 0 es inválido y se nombra (cambio deliberado)', () => {
  const r = deriveCosts({ ...VALID_INPUT, millas_semana_promedio: 0 });
  assertEquals(r.valido, false);
  assertEquals(r.faltante, 'millas_semana_promedio');
});

Deno.test('costos: % pago conductor fuera de [0,1) es inválido y se nombra', () => {
  const cien = deriveCosts({ ...VALID_INPUT, pago_conductor_porcentaje: 100 });
  assertEquals(cien.valido, false);
  assertEquals(cien.faltante, 'pago_conductor_porcentaje');

  const negativo = deriveCosts({ ...VALID_INPUT, pago_conductor_porcentaje: -5 });
  assertEquals(negativo.valido, false);
  assertEquals(negativo.faltante, 'pago_conductor_porcentaje');
});

// ─────────────────────────────────────────────────────────────────────────────
// RED DE REGRESIÓN — el shape que llama Onboarding.jsx (solo diésel/MPG/%
// conductor, más FIXED_COST_DEFAULTS) y el que llama CostCalculator.jsx (todos
// los campos explícitos). Ambos deben terminar en el mismo lugar.
// ─────────────────────────────────────────────────────────────────────────────

const ONBOARDING_SHAPE = {
  diesel_precio: 5.40,
  mpg: 6.5,
  pago_conductor_porcentaje: 25,
  ...FIXED_COST_DEFAULTS,
};

Deno.test('costos: onboarding con valores por defecto deja un estado reconocido (válido y finito)', () => {
  const r = deriveCosts(ONBOARDING_SHAPE);
  assertEquals(r.valido, true);
  assertEquals(r.faltante, null);
  assert(Number.isFinite(r.costoPorMilla));
  assert(Number.isFinite(r.tarifaBreakEven));
});

Deno.test('costos: no hay drift entre el shape de llamada de Onboarding y el de la Calculadora', () => {
  const calculadoraShape = {
    diesel_precio: 5.40,
    mpg: 6.5,
    seguro_semanal: FIXED_COST_DEFAULTS.seguro_semanal,
    lease_semanal: FIXED_COST_DEFAULTS.lease_semanal,
    pago_conductor_porcentaje: 25,
    otros_gastos_semanales: FIXED_COST_DEFAULTS.otros_gastos_semanales,
    millas_semana_promedio: FIXED_COST_DEFAULTS.millas_semana_promedio,
    tarifa_objetivo: 3.0, // campo extra que deriveCosts ignora
  };
  const onboarding = deriveCosts(ONBOARDING_SHAPE);
  const calculadora = deriveCosts(calculadoraShape);
  assertEquals(onboarding.costoPorMilla, calculadora.costoPorMilla);
  assertEquals(onboarding.tarifaBreakEven, calculadora.tarifaBreakEven);
  assertEquals(onboarding.valido, calculadora.valido);
});
