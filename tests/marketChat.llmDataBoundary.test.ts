// ─────────────────────────────────────────────────────────────────────────────
// Pruebas de llmDataBoundary.ts (reglas-v3-multiestado, Fase 7 — frontera
// LLM/datos, criterio de éxito 4, riesgo 3).
//
// "Nada de datos queda en manos del modelo." Este módulo es el validador
// automático: escanea el texto final y verifica que TODA cifra numérica
// venga del bloque calculado (rate_check) o de las constantes de KB
// (general) — nunca de una recalculación o redondeo hecho por el redactor.
// ─────────────────────────────────────────────────────────────────────────────

import { assertEquals, assert } from 'jsr:@std/assert@1';
import {
  extractNumericTokens,
  buildAllowedNumbersSet,
  assertNoInventedFigures,
  buildBoundaryFallbackMarkdown,
  figuresFromCalculatedQuote,
  buildRateCheckAllowedNumbers,
  buildKbConstantNumbers,
  buildGeneralIntentAllowedNumbers,
} from '../base44/functions/marketChat/llmDataBoundary.ts';
import {
  EQUIPMENT_BENCHMARKS,
  resolveDrayageQuote,
  resolveGenericQuote,
  buildRateCheckMarkdown,
} from '../base44/functions/marketChat/rateEngine.ts';

const dryVan = EQUIPMENT_BENCHMARKS.find(e => e.id === 'dry_van')!;

function getQuote(outcome: { kind: string; calculo?: unknown }) {
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  return outcome.calculo as Parameters<typeof buildRateCheckMarkdown>[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACCIÓN DE CIFRAS
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('extractNumericTokens: enteros, miles con coma y decimales', () => {
  assertEquals(extractNumericTokens('$1,264 a $3.01/mi sobre 420 mi'), [1264, 3.01, 420]);
});

Deno.test('extractNumericTokens: porcentajes — el "%" queda fuera del número', () => {
  assertEquals(extractNumericTokens('margen del 40.0% sobre $100'), [40.0, 100]);
});

Deno.test('extractNumericTokens: texto sin números da arreglo vacío', () => {
  assertEquals(extractNumericTokens('Solo manejo temas de freight.'), []);
  assertEquals(extractNumericTokens(''), []);
  assertEquals(extractNumericTokens(null), []);
  assertEquals(extractNumericTokens(undefined), []);
});

Deno.test('buildAllowedNumbersSet: ignora null/undefined/NaN, no rompe', () => {
  const set = buildAllowedNumbersSet([100, null, undefined, NaN, 200.5]);
  assertEquals(set.has(100), true);
  assertEquals(set.has(200.5), true);
  assertEquals(set.size, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// EL VALIDADOR — criterio de éxito 4
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('assertNoInventedFigures: todas las cifras están permitidas → pasa', () => {
  const permitidas = buildAllowedNumbersSet([1264, 420, 3.01]);
  const r = assertNoInventedFigures('El precio es $1,264 sobre 420 mi a $3.01/mi.', permitidas);
  assertEquals(r.ok, true);
  assertEquals(r.invented, []);
});

Deno.test('assertNoInventedFigures: el LLM "intenta" agregar una cifra no autorizada → se detecta y bloquea', () => {
  const permitidas = buildAllowedNumbersSet([1264, 420, 3.01]);
  // El redactor "explica el cálculo" y recalcula/redondea una cifra distinta
  // (kickoff riesgo 3): acá dice $1,300 en vez de los $1,264 calculados.
  const r = assertNoInventedFigures('Redondeando, serían unos $1,300 por la ruta de 420 mi.', permitidas);
  assertEquals(r.ok, false);
  assert(r.invented.includes(1300), 'debe detectar la cifra 1300 como inventada');
});

Deno.test('assertNoInventedFigures: tolera ruido de redondeo mínimo (centavos), no una cifra distinta', () => {
  const permitidas = buildAllowedNumbersSet([3.01]);
  assertEquals(assertNoInventedFigures('$3.01/mi', permitidas).ok, true);
  assertEquals(assertNoInventedFigures('$3.02/mi', permitidas).ok, false, 'un centavo de diferencia real SÍ debe fallar — la tolerancia es solo para ruido de formateo, no para inventar una cifra "parecida"');
});

Deno.test('assertNoInventedFigures: texto vacío o sin cifras siempre pasa, cualquiera sea el conjunto permitido', () => {
  assertEquals(assertNoInventedFigures('', new Set()).ok, true);
  assertEquals(assertNoInventedFigures('Solo manejo temas de freight.', new Set()).ok, true);
});

Deno.test('buildBoundaryFallbackMarkdown: no repite ninguna cifra (sería absurdo que el propio fallback fallara el chequeo)', () => {
  const texto = buildBoundaryFallbackMarkdown();
  assertEquals(extractNumericTokens(texto).length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// CONJUNTO AUTORIZADO — RATE_CHECK (bloque calculado real)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('rate_check: el texto generado por buildRateCheckMarkdown SIEMPRE pasa contra su propio bloque calculado', () => {
  const escenarios = [
    getQuote(resolveDrayageQuote({ destinoRaw: 'Pompano Beach', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: 500 })),
    getQuote(resolveDrayageQuote({ destinoRaw: 'Houston', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: 2.0, tarifaOfrecida: 900, costoPorMillaPropio: 1.5 })),
    getQuote(resolveDrayageQuote({ destinoRaw: 'Houston', tamano: '45', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null })),
    getQuote(resolveDrayageQuote({ destinoRaw: 'Fake City, Florida', tamano: '40', millasIdaDeclaradas: 90, pagoCamionRpm: null, tarifaOfrecida: null })),
    getQuote(resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 420, pagoCamionRpm: 2.5, tarifaOfrecida: 1200 })),
    getQuote(resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 60, pagoCamionRpm: null, tarifaOfrecida: null })),
  ];
  for (const q of escenarios) {
    const texto = buildRateCheckMarkdown(q);
    const permitidas = buildRateCheckAllowedNumbers(q);
    const r = assertNoInventedFigures(texto, permitidas);
    assertEquals(r.ok, true, `no debería haber cifras inventadas en: "${texto}" — encontradas fuera de rango: ${JSON.stringify(r.invented)}`);
  }
});

Deno.test('rate_check: una cifra que NO viene del bloque calculado (simulando un redactor que la inventa) se detecta', () => {
  const q = getQuote(resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 420, pagoCamionRpm: null, tarifaOfrecida: null }));
  const permitidas = buildRateCheckAllowedNumbers(q);
  // El bloque calculado real dice $1,264 (420mi × $3.01/mi); acá simulamos un
  // redactor que "ayuda" agregando una cifra de bolsillo que no calculó nadie.
  const textoConCifraInventada = buildRateCheckMarkdown(q) + '\nEn total te conviene pedir $50 más por el peaje.';
  const r = assertNoInventedFigures(textoConCifraInventada, permitidas);
  assertEquals(r.ok, false);
  assert(r.invented.includes(50));
});

Deno.test('figuresFromCalculatedQuote: incluye las referencias de ruta cuando la ruta consultada está ausente', () => {
  const q = getQuote(resolveDrayageQuote({ destinoRaw: 'Fake City, Florida', tamano: '40', millasIdaDeclaradas: 90, pagoCamionRpm: null, tarifaOfrecida: null }));
  const numeros = figuresFromCalculatedQuote(q);
  for (const r of q.referencias) {
    assert(numeros.includes(r.objetivo), `debe incluir el objetivo de la referencia ${r.ciudad}`);
    assert(numeros.includes(r.millas_ida), `debe incluir las millas de la referencia ${r.ciudad}`);
  }
});

Deno.test('figuresFromCalculatedQuote: incluye los montos de accesoriales filtrados', () => {
  const q = getQuote(resolveDrayageQuote({
    destinoRaw: 'Houston', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null,
    accessorialTriggers: ['fuel', 'combustible', 'surcharge'],
  }));
  assert(q.accesoriales && q.accesoriales.items.length > 0, 'fixture debe traer al menos un accesorial de fuel surcharge');
  const numeros = figuresFromCalculatedQuote(q);
  for (const item of q.accesoriales!.items) {
    const cifrasDelMonto = extractNumericTokens(item.monto);
    for (const c of cifrasDelMonto) assert(numeros.includes(c), `debe incluir ${c} de "${item.monto}"`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONJUNTO AUTORIZADO — GENERAL (constantes de KB)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('general: las constantes de KB (RPM, detention, HOS, deadhead, conteo de rutas) están permitidas', () => {
  const permitidas = buildGeneralIntentAllowedNumbers();
  const respuestaLegitima = 'El RPM base de dry van es $3.01/mi, y para reefer es $3.42/mi. Detention: $75/hr tras 2h libres.';
  const r = assertNoInventedFigures(respuestaLegitima, permitidas);
  assertEquals(r.ok, true, `figuras encontradas fuera de rango: ${JSON.stringify(r.invented)}`);
});

Deno.test('general: una cifra fuera de la KB (inventada por el LLM) se detecta', () => {
  const permitidas = buildGeneralIntentAllowedNumbers();
  // 9.99 no coincide con ningún RPM/detention/accessorial/HOS/deadhead/conteo
  // de ruta de la KB — a propósito, para no chocar con otra constante real
  // (p. ej. 2.75 SÍ es el rpm_min legítimo de step_deck/drayage_20).
  const r = assertNoInventedFigures('El RPM base de dry van es $9.99/mi.', permitidas);
  assertEquals(r.ok, false);
  assert(r.invented.includes(9.99));
});

Deno.test('general: los valores de CostConfig mostrados ese turno se agregan al conjunto permitido', () => {
  const permitidas = buildGeneralIntentAllowedNumbers([5.75, 7.2, 1.85]);
  const r = assertNoInventedFigures('Con diésel a $5.75/gal y ${7.2} MPG, tu costo es $1.85/mi.'.replace('${7.2} MPG', '7.2 MPG'), permitidas);
  assertEquals(r.ok, true, `figuras fuera de rango: ${JSON.stringify(r.invented)}`);
});

Deno.test('buildKbConstantNumbers: incluye el conteo exacto de rutas (209/50/259, criterio 1)', () => {
  const numeros = buildKbConstantNumbers();
  assert(numeros.includes(209));
  assert(numeros.includes(50));
  assert(numeros.includes(259));
});
