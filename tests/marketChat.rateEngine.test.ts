// ─────────────────────────────────────────────────────────────────────────────
// Pruebas del motor de tarifas del Chat de Mercado.
//
// Cubren las funciones puras de base44/functions/marketChat/rateEngine.ts.
// Viven FUERA del directorio de la función a propósito: Base44 despliega ese
// directorio completo, y no queremos subir código de prueba a producción.
//
// Correr con:  npm run test:functions
//
// ─────────────────────────────────────────────────────────────────────────────
// reglas-v3-multiestado, Fase 3 — ACTUALIZACIÓN DELIBERADA DE PRUEBAS VIEJAS
// (kickoff criterio 17, riesgo 2; task 7.3 aplicada por adelantado porque el
// bloqueo es directo: el motor invierte de arquitectura y las pruebas viejas
// afirmaban el comportamiento del catálogo de 7 lanes + guardarraíl geográfico
// + estimación de millas por IA, todo eliminado en esta fase).
//
// Cada sección afectada documenta explícitamente qué se quitó y por qué. Las
// secciones NO relacionadas (guardarraíl de TEMA, formato, entrada, historial)
// quedan intactas — son una feature distinta que este SDD no toca.
// ─────────────────────────────────────────────────────────────────────────────

import {
  assertEquals,
  assertStringIncludes,
  assert,
  assertExists,
} from 'jsr:@std/assert@1';

import {
  EQUIPMENT_BENCHMARKS,
  DETENTION,
  normalizeText,
  matchesAny,
  resolveEquipment,
  buildEquipmentQuestionMarkdown,
  computeVerdict,
  computeFloorTarget,
  computeSegundaLectura,
  dentroDelRangoDeSanidad,
  SANITY_MIN_MILES,
  SANITY_MAX_MILES,
  SHORT_HAUL_MILES_THRESHOLD,
  SHORT_HAUL_FLOOR,
  SHORT_HAUL_TARGET,
  formatUSD,
  resolveDrayageQuote,
  resolveGenericQuote,
  buildRateCheckMarkdown,
  buildAskMilesMarkdown,
  buildSanityCapMarkdown,
  buildGeneralMarkdown,
  buildMissingDataMarkdown,
  safeFallbackContent,
  capHistory,
  isValidMessages,
  esConsultaDeNegocio,
  ultimoMensajeDelDispatcher,
  resolveIntent,
  buildOffTopicMarkdown,
  esFueraDeTema,
  resolveAccessorialsForState,
  filterAccessorialsByTriggers,
  preguntaPorTotalRedondo,
  buildDrayageRoundTripMarkdown,
  computeMarginVerdict,
  resolveProfileMarginVerdict,
  buildMarginVerdictMarkdown,
  MARGIN_THRESHOLD_STRONG,
  MARGIN_THRESHOLD_ACCEPTABLE,
} from '../base44/functions/marketChat/rateEngine.ts';

// ─────────────────────────────────────────────────────────────────────────────
// DATOS DE REFERENCIA
// ─────────────────────────────────────────────────────────────────────────────

// Helpers de módulo para las pruebas de contrato (criterios 15/16) más abajo,
// que necesitan un equipo y un "unwrap" de outcome fuera del scope de un test
// puntual.
const dryVan = EQUIPMENT_BENCHMARKS.find(e => e.id === 'dry_van')!;

function getQuote(outcome: { kind: string; calculo?: unknown }) {
  if (outcome.kind !== 'quote') throw new Error('fixture inválido: se esperaba kind="quote"');
  return outcome.calculo as Parameters<typeof buildRateCheckMarkdown>[0];
}

// old=dry_van 2.00/2.50, reefer 2.30/2.80, flatbed 2.50/3.00
// new=dry_van 3.01, reefer 3.42, flatbed 3.64 (mín=objetivo: kickoff da una
// sola cifra "RPM base" por equipo, no un par)
// why=kickoff §6 — reemplaza la referencia por milla vieja; el batch anterior
// ya había encontrado que el código real tenía reefer en 2.30 (no 2.20 como
// decía el kickoff), así que el valor nuevo reemplaza a 2.30, no a 2.20.
// step_deck/drayage_20/drayage_40/power_only NO cambian — el kickoff no los menciona.
Deno.test('datos: los 7 equipos — dry_van/reefer/flatbed con el nuevo RPM base (kickoff §6)', () => {
  assertEquals(EQUIPMENT_BENCHMARKS.length, 7);
  const porId = Object.fromEntries(EQUIPMENT_BENCHMARKS.map(e => [e.id, e]));
  assertEquals(porId.dry_van.rpm_target, 3.01);
  assertEquals(porId.dry_van.rpm_min, 3.01);
  assertEquals(porId.reefer.rpm_target, 3.42);
  assertEquals(porId.flatbed.rpm_target, 3.64);
  assertEquals(porId.step_deck.rpm_min, 2.75);
  assertEquals(porId.drayage_20.rpm_min, 2.75);
  assertEquals(porId.drayage_20.rpm_target, 3.50);
  assertEquals(porId.drayage_40.rpm_min, 2.50);
  assertEquals(porId.power_only.rpm_min, 1.50);
});

Deno.test('datos: el detention tiene un solo valor estándar', () => {
  assertEquals(DETENTION.standard, 75);
  assertEquals(DETENTION.min, 50);
  assertEquals(DETENTION.max, 100);
  assertEquals(DETENTION.free_hours, 2);
});

// old=`datos: el recargo de Port Everglades es $50` + su uso en computeFloor/
// buildRateCheckMarkdown
// new=eliminado (PORT_EVERGLADES_SURCHARGE ya no existe)
// why=el recargo estaba atado al catálogo de LANES/findLane que esta fase
// elimina por completo. Reintroducirlo con el diseño correcto (como un
// accesorial más, no como un caso especial del cálculo de millas) es Fase 5
// (accesoriales), que ya trae su propio fallback de vecino y su propia forma
// de sumar cargos — no se inventa una wiring provisoria acá.

// ─────────────────────────────────────────────────────────────────────────────
// PISO / OBJETIVO CONSCIENTES DE TABLA — reemplaza el sistema viejo de tramos
// flat (computeFloor/computeTarget/getFlatBucket/resolveFloorBasis, y su tabla
// FLAT_MINIMUMS). Ver rateEngine.ts, sección "PISO / OBJETIVO CONSCIENTES DE
// TABLA" para el detalle de la regla nueva.
// old=`piso: en ruta corta manda el mínimo del tramo...` (computeFloor con
// bucket genérico) + `tramos: los bordes caen en el tramo correcto`
// (getFlatBucket) + `base del piso: el tramo manda...` (resolveFloorBasis)
// new=computeFloorTarget: objetivo=tabla>derivado>cálculo; piso=tabla(solo
// TX)>dato del usuario>sin dato
// why=kickoff §2 — "el piso sale del dato del usuario... sin dato del usuario
// no hay piso, y se dice". El sistema de tramos genéricos por millas ($400 en
// <50mi, etc.) no tenía ninguna base en la tabla real y competía como fuente
// de verdad paralela; Fase 4 introduce el reemplazo correcto (mínimos v3 §7
// por equipo) cuando corresponda.
Deno.test('piso/objetivo: con tabla de TX (piso Y objetivo), el piso de tabla manda sobre el dato del usuario', () => {
  const r = computeFloorTarget({ tablaPiso: 550, tablaObjetivo: 950, targetEsDerivado: false, millasIda: 5, rpmBase: null, pagoCamionRpm: 10 });
  assertEquals(r, { floor: 550, floorSource: 'tabla', target: 950, targetSource: 'tabla' });
});

Deno.test('piso/objetivo: sin piso de tabla (FL), el piso sale del dato del usuario', () => {
  const r = computeFloorTarget({ tablaPiso: null, tablaObjetivo: 473, targetEsDerivado: false, millasIda: 37, rpmBase: null, pagoCamionRpm: 2.5 });
  assertEquals(r.target, 473);
  assertEquals(r.targetSource, 'tabla');
  assertEquals(r.floor, 93); // round(2.5 * 37) = 92.5 → 93
  assertEquals(r.floorSource, 'dato_usuario');
});

Deno.test('piso/objetivo: sin tabla de piso y sin dato del usuario, NO hay piso — se declara, no se inventa', () => {
  const r = computeFloorTarget({ tablaPiso: null, tablaObjetivo: 473, targetEsDerivado: false, millasIda: 37, rpmBase: null, pagoCamionRpm: null });
  assertEquals(r.floor, null);
  assertEquals(r.floorSource, 'sin_dato');
});

Deno.test('piso/objetivo: sin tabla en absoluto, el objetivo se calcula por RPM × millas (reproduce v3 §6)', () => {
  const r = computeFloorTarget({ tablaPiso: null, tablaObjetivo: null, targetEsDerivado: false, millasIda: 420, rpmBase: 3.01, pagoCamionRpm: null });
  assertEquals(r.target, 1264); // 420 × 3.01 = 1264.2 → 1264, el ejemplo exacto de v3 §6
  assertEquals(r.targetSource, 'calculo');
  assertEquals(r.floor, null);
  assertEquals(r.floorSource, 'sin_dato');
});

Deno.test('piso/objetivo: un objetivo derivado (TX no-40\') se marca "derivado", no "tabla"', () => {
  const r = computeFloorTarget({ tablaPiso: 500, tablaObjetivo: 864, targetEsDerivado: true, millasIda: 5, rpmBase: null, pagoCamionRpm: null });
  assertEquals(r.targetSource, 'derivado');
  assertEquals(r.floorSource, 'tabla'); // el piso derivado SÍ es tabla-derivada, no dato de usuario
});

// ─────────────────────────────────────────────────────────────────────────────
// TOPE DE SANIDAD
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('sanidad: el rango defendible es 10-3000 mi', () => {
  assertEquals(SANITY_MIN_MILES, 10);
  assertEquals(SANITY_MAX_MILES, 3000);
  assertEquals(dentroDelRangoDeSanidad(4), false);
  assertEquals(dentroDelRangoDeSanidad(10), true);
  assertEquals(dentroDelRangoDeSanidad(3000), true);
  assertEquals(dentroDelRangoDeSanidad(3001), false);
});

Deno.test('sanidad: el mensaje de tope no entrega ninguna cifra', () => {
  const out = buildSanityCapMarkdown();
  assertEquals(/\$\d/.test(out), false);
  assertStringIncludes(out, 'no tengo una referencia confiable');
});

// ─────────────────────────────────────────────────────────────────────────────
// EQUIPO (sin tabla) — sin cambios respecto de la fase anterior.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('equipo: los 7 ids válidos se resuelven sin asumir nada', () => {
  for (const e of EQUIPMENT_BENCHMARKS) {
    const r = resolveEquipment(e.id);
    assertEquals(r.status, 'ok');
    if (r.status === 'ok') assertEquals(r.equipment.id, e.id);
  }
});

Deno.test('equipo: un id desconocido pide el equipo en vez de asumir dry van', () => {
  const r = resolveEquipment('unknown');
  assertEquals(r.status, 'ask');
  if (r.status === 'ask') assertEquals(r.reason, 'missing');
});

Deno.test('equipo: sin dato pide el equipo en vez de asumir dry van', () => {
  for (const raw of [undefined, null, '']) {
    const r = resolveEquipment(raw);
    assertEquals(r.status, 'ask');
    if (r.status === 'ask') assertEquals(r.reason, 'missing');
  }
});

Deno.test('equipo: "drayage" a secas pide el tamaño, no cae en dry van', () => {
  const r = resolveEquipment('drayage');
  assertEquals(r.status, 'ask');
  if (r.status === 'ask') assertEquals(r.reason, 'size');
});

Deno.test('equipo: resolveEquipment es determinista — 10 llamadas idénticas dan el mismo resultado', () => {
  const resultados = Array.from({ length: 10 }, () => resolveEquipment('reefer'));
  for (const r of resultados) assertEquals(r, resultados[0]);
});

// old=`assertStringIncludes(size, "20' o de 40'")` (la pregunta de tamaño solo
// contemplaba 20'/40')
// new=`assertStringIncludes(size, "45'")` (la pregunta ahora incluye los 4
// tamaños que la tabla y la derivación de Texas soportan)
// why=Fase 3 — 45' y 20' Heavy ya no caen indefinidamente en "sin benchmark
// propio" (la Fase 0 los dejaba pendientes a propósito); ahora se resuelven
// nativamente contra tabla + sizeDerivation.ts, así que la pregunta al usuario
// debe ofrecer las 4 opciones reales.
Deno.test('equipo: buildEquipmentQuestionMarkdown tiene copia distinta para "missing" y "size"', () => {
  const missing = buildEquipmentQuestionMarkdown('missing');
  const size = buildEquipmentQuestionMarkdown('size');
  assertStringIncludes(missing, 'qué equipo');
  assertStringIncludes(size, "45'");
  assertEquals(missing === size, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// COTIZACIÓN DE DRAYAGE — el corazón de la Fase 3. Reemplaza por completo:
// old=`millas: el catálogo gana sobre la estimación de la IA`, `millas:
// redondo es el comportamiento por defecto`, `millas: "solo ida" divide el
// trayecto del catálogo`, `rutas: los alias del catálogo se reconocen`,
// `rutas: la dirección no importa...`, `millas: sin ruta catalogada usa la
// estimación de la IA...`, `millas: marca confianza baja...`, `rutas: Port
// Everglades activa el recargo...`, `rutas: dos extremos base no resuelven
// ninguna lane` (findLane/LANES/resolveMiles con source:'llm')
// new=resolveDrayageQuote: tabla-primero (FL/TX), derivación de tamaño (TX),
// cálculo-siempre sin tabla, referencias deterministas, tope de sanidad
// why=kickoff §1/§3/§6 — el catálogo de 7 lanes de Miami y la estimación de
// millas por IA se eliminan; la tabla real de 259 rutas + el cálculo por RPM
// los reemplazan. "millas: sin ruta y sin estimación NO inventa piso" se
// preserva en espíritu como "sin match de tabla y sin dato del usuario → se
// pregunta" (ver sección ASK_MILES más abajo) — el principio no cambió, solo
// la fuente de datos.
// ─────────────────────────────────────────────────────────────────────────────

// Criterio 8: una ruta de FL devuelve su CT exacto (Pompano pasa de $500 fijo a la cifra de tabla).
Deno.test('drayage: Pompano Beach en tabla devuelve su CT exacto (criterio 8)', () => {
  const outcome = resolveDrayageQuote({
    destinoRaw: 'Pompano Beach',
    tamano: '40',
    millasIdaDeclaradas: null,
    pagoCamionRpm: null,
    tarifaOfrecida: null,
  });
  assertEquals(outcome.kind, 'quote');
  if (outcome.kind !== 'quote') throw new Error('unreachable');
  assertEquals(outcome.calculo.estado, 'FL');
  assertEquals(outcome.calculo.ciudad, 'Pompano Beach');
  assertEquals(outcome.calculo.objetivo, 473);
  assertEquals(outcome.calculo.objetivo === 500, false); // ya NO es el viejo hardcode de $500
  assertEquals(outcome.calculo.targetSource, 'tabla');
  assertEquals(outcome.calculo.floorSource, 'sin_dato'); // FL nunca trae piso de tabla
  assertEquals(outcome.calculo.referencias.length, 0); // hay match: no se muestran referencias
});

// Criterio 9: Houston devuelve piso Y objetivo de la tabla de Texas.
Deno.test('drayage: Houston 40\' devuelve piso y objetivo de la tabla de Texas (criterio 9)', () => {
  const outcome = resolveDrayageQuote({
    destinoRaw: 'Houston',
    tamano: '40',
    millasIdaDeclaradas: null,
    pagoCamionRpm: null,
    tarifaOfrecida: null,
  });
  assertEquals(outcome.kind, 'quote');
  if (outcome.kind !== 'quote') throw new Error('unreachable');
  assertEquals(outcome.calculo.estado, 'TX');
  assertEquals(outcome.calculo.piso, 550);
  assertEquals(outcome.calculo.objetivo, 950);
  assertEquals(outcome.calculo.floorSource, 'tabla');
  assertEquals(outcome.calculo.targetSource, 'tabla');
});

// Criterio 10: un 20' en Houston no inventa una tarifa de tabla — la deriva del 40' y lo declara.
Deno.test('drayage: 20\' en Houston deriva del 40\' de tabla y lo declara (criterio 10, Decisión 12-C)', () => {
  const outcome = resolveDrayageQuote({
    destinoRaw: 'Houston',
    tamano: '20',
    millasIdaDeclaradas: null,
    pagoCamionRpm: null,
    tarifaOfrecida: null,
  });
  assertEquals(outcome.kind, 'quote');
  if (outcome.kind !== 'quote') throw new Error('unreachable');
  assertEquals(outcome.calculo.objetivo, 864); // round(950 / 1.10)
  assertEquals(outcome.calculo.piso, 500); // round(550 / 1.10)
  assertEquals(outcome.calculo.targetSource, 'derivado');
  assertEquals(outcome.calculo.dobleSupuesto, false);
});

Deno.test('drayage: 45\' en Houston deriva con doble supuesto (kickoff §12 riesgo nuevo)', () => {
  const outcome = resolveDrayageQuote({
    destinoRaw: 'Houston',
    tamano: '45',
    millasIdaDeclaradas: null,
    pagoCamionRpm: null,
    tarifaOfrecida: null,
  });
  assertEquals(outcome.kind, 'quote');
  if (outcome.kind !== 'quote') throw new Error('unreachable');
  assertEquals(outcome.calculo.objetivo, 967); // round(950 * 1.018)
  assertEquals(outcome.calculo.targetSource, 'derivado');
  assertEquals(outcome.calculo.dobleSupuesto, true);
});

// Criterio 2: un estado sin tabla se cotiza por cálculo — hoy se rechazaba, ahora no.
Deno.test('drayage: Georgia (sin tabla) se cotiza por cálculo y ofrece referencias de Florida (criterios 2 y 14)', () => {
  const outcome = resolveDrayageQuote({
    destinoRaw: 'Savannah, Georgia',
    tamano: '40',
    millasIdaDeclaradas: 60,
    pagoCamionRpm: null,
    tarifaOfrecida: null,
  });
  assertEquals(outcome.kind, 'quote');
  if (outcome.kind !== 'quote') throw new Error('unreachable');
  assertEquals(outcome.calculo.targetSource, 'calculo');
  assertEquals(outcome.calculo.objetivo, 195); // round(3.25 × 60), RPM objetivo de drayage_40
  assertEquals(outcome.calculo.referenciasEstadoNombre, 'Florida'); // vecino cercano, SÍ se nombra
  assertEquals(outcome.calculo.referencias.length, 3);
  assertEquals(outcome.calculo.referencias[0].ciudad, 'Boynton Beach');
});

Deno.test('drayage: un estado lejano (Ohio) usa cálculo y NO nombra ningún estado de origen (Decisión 11-A)', () => {
  const outcome = resolveDrayageQuote({
    destinoRaw: 'Columbus, Ohio',
    tamano: '40',
    millasIdaDeclaradas: 500,
    pagoCamionRpm: null,
    tarifaOfrecida: null,
  });
  assertEquals(outcome.kind, 'quote');
  if (outcome.kind !== 'quote') throw new Error('unreachable');
  assertEquals(outcome.calculo.referenciasEstadoNombre, null);
  assert(outcome.calculo.referencias.length > 0, 'debería ofrecer referencias igual, solo que sin nombrar el estado');
});

Deno.test('drayage: una ciudad de Florida ausente de la tabla ofrece referencias reales de Florida, nunca extrapola (criterio 11)', () => {
  const outcome = resolveDrayageQuote({
    destinoRaw: 'Fake City, Florida',
    tamano: '40',
    millasIdaDeclaradas: 90,
    pagoCamionRpm: null,
    tarifaOfrecida: null,
  });
  assertEquals(outcome.kind, 'quote');
  if (outcome.kind !== 'quote') throw new Error('unreachable');
  assertEquals(outcome.calculo.targetSource, 'calculo'); // NUNCA una tarifa de tabla ajustada
  assertEquals(outcome.calculo.referenciasEstadoNombre, 'Florida');
  assertEquals(outcome.calculo.referencias.length, 3);
  assertEquals(outcome.calculo.referencias[0], { ciudad: 'Jupiter', millas_ida: 88, objetivo: 825, tamanoMostrado: '40' });
  assertEquals(outcome.calculo.referencias[1].ciudad, 'Belle Glade');
  assertEquals(outcome.calculo.referencias[2].ciudad, 'Hobe Sound');
});

// Criterio 3: sin match de tabla y sin millas del usuario, se pregunta — nunca se inventa.
Deno.test('drayage: sin match de tabla y sin millas del usuario, se pregunta (criterio 3)', () => {
  const outcome = resolveDrayageQuote({
    destinoRaw: 'Ciudad Inexistente',
    tamano: '40',
    millasIdaDeclaradas: null,
    pagoCamionRpm: null,
    tarifaOfrecida: null,
  });
  assertEquals(outcome, { kind: 'ask_miles', ciudadConocida: null });
});

Deno.test('drayage: millas fuera del rango de sanidad no se entrega como cotización', () => {
  const outcome = resolveDrayageQuote({
    destinoRaw: 'Ciudad Inexistente',
    tamano: '40',
    millasIdaDeclaradas: 4,
    pagoCamionRpm: null,
    tarifaOfrecida: null,
  });
  assertEquals(outcome, { kind: 'fuera_de_rango' });
});

Deno.test('drayage: resolveDrayageQuote es determinista — 10 llamadas idénticas dan el mismo resultado (criterio 12)', () => {
  const input = { destinoRaw: 'Savannah, Georgia', tamano: '40' as const, millasIdaDeclaradas: 60, pagoCamionRpm: null, tarifaOfrecida: null };
  const resultados = Array.from({ length: 10 }, () => resolveDrayageQuote(input));
  for (const r of resultados) assertEquals(r, resultados[0]);
});

// ─────────────────────────────────────────────────────────────────────────────
// COTIZACIÓN GENÉRICA (sin tabla) — dry_van/reefer/flatbed/step_deck/power_only.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('genérico: reproduce el ejemplo exacto de v3 §6 (420 mi, dry van $3.01/mi → $1,264)', () => {
  const dryVan = EQUIPMENT_BENCHMARKS.find(e => e.id === 'dry_van')!;
  const outcome = resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 420, pagoCamionRpm: null, tarifaOfrecida: null });
  assertEquals(outcome.kind, 'quote');
  if (outcome.kind !== 'quote') throw new Error('unreachable');
  assertEquals(outcome.calculo.objetivo, 1264);
  assertEquals(outcome.calculo.targetSource, 'calculo');
});

Deno.test('genérico: sin millas del usuario, se pregunta', () => {
  const dryVan = EQUIPMENT_BENCHMARKS.find(e => e.id === 'dry_van')!;
  const outcome = resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null });
  assertEquals(outcome, { kind: 'ask_miles' });
});

Deno.test('genérico: millas fuera de rango no se entrega como cotización', () => {
  const dryVan = EQUIPMENT_BENCHMARKS.find(e => e.id === 'dry_van')!;
  const outcome = resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 4, pagoCamionRpm: null, tarifaOfrecida: null });
  assertEquals(outcome, { kind: 'fuera_de_rango' });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOBLE LECTURA — reglas-v3-multiestado Fase 4 (kickoff §4, T-1 no aplica acá;
// spec "One-Way Basis With Round-Trip Second Reading"). El precio sugerido es
// SIEMPRE de ida; la lectura de ida y vuelta es una segunda cifra, declarada
// como HIPÓTESIS del regreso vacío — nunca se asume como dato.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('segunda lectura: reproduce el ejemplo EXACTO de v3 §6 (criterio 5) — 420mi→$1,264 ida, 840mi→$1.50/mi', () => {
  const r = computeSegundaLectura(1264, 420);
  assertEquals(r.millasRedondo, 840);
  assertEquals(r.rpmRedondo, 1.5);
});

Deno.test('segunda lectura: genérico (sin tabla, ≥100mi) trae segundaLectura con el ejemplo de v3 §6', () => {
  const dryVan = EQUIPMENT_BENCHMARKS.find(e => e.id === 'dry_van')!;
  const outcome = resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 420, pagoCamionRpm: null, tarifaOfrecida: null });
  assertEquals(outcome.kind, 'quote');
  if (outcome.kind !== 'quote') throw new Error('unreachable');
  assertEquals(outcome.calculo.segundaLectura, { millasRedondo: 840, rpmRedondo: 1.5 });
});

Deno.test('respuesta: la segunda lectura aparece como hipótesis explícita, no como dato', () => {
  const dryVan = EQUIPMENT_BENCHMARKS.find(e => e.id === 'dry_van')!;
  const outcome = resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 420, pagoCamionRpm: null, tarifaOfrecida: null });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  const out = buildRateCheckMarkdown(outcome.calculo);
  assertStringIncludes(out, 'HIPÓTESIS');
  assertStringIncludes(out, '840 mi');
  assertStringIncludes(out, '$1.50/mi');
});

Deno.test('segunda lectura: NO aparece en tramo corto (<100mi) — "no se asume carga de regreso" (spec)', () => {
  const dryVan = EQUIPMENT_BENCHMARKS.find(e => e.id === 'dry_van')!;
  const outcome = resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 60, pagoCamionRpm: null, tarifaOfrecida: null });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  assertEquals(outcome.calculo.segundaLectura, null);
  const out = buildRateCheckMarkdown(outcome.calculo);
  assertEquals(out.includes('HIPÓTESIS'), false);
});

Deno.test('segunda lectura: drayage NUNCA la trae, ni con tabla ni con cálculo (Decisión 1-A / criterio 7)', () => {
  const conTabla = resolveDrayageQuote({ destinoRaw: 'Pompano Beach', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null });
  const sinTabla = resolveDrayageQuote({ destinoRaw: 'Columbus, Ohio', tamano: '40', millasIdaDeclaradas: 500, pagoCamionRpm: null, tarifaOfrecida: null });
  if (conTabla.kind !== 'quote' || sinTabla.kind !== 'quote') throw new Error('fixture inválido');
  assertEquals(conTabla.calculo.segundaLectura, null);
  assertEquals(sinTabla.calculo.segundaLectura, null);
  assertEquals(buildRateCheckMarkdown(conTabla.calculo).includes('HIPÓTESIS'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// DRAYAGE: TOTAL REDONDO SOLO A PEDIDO — Decisión 2-A / criterio 7. Por defecto
// NUNCA se muestra; si el usuario pregunta explícitamente, se responde con el
// total exacto (no ×2 ciego: usa la semántica real de millas de cada tabla).
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('drayage total redondo: preguntaPorTotalRedondo detecta la pregunta explícita, no adivina', () => {
  assert(preguntaPorTotalRedondo('¿y si cuento la vuelta, cuánto sería en total?'));
  assert(preguntaPorTotalRedondo('dame el total redondo'));
  assert(preguntaPorTotalRedondo('¿cuánto es ida y vuelta?'));
  assertEquals(preguntaPorTotalRedondo('¿cuánto sale a Pompano?'), false);
  assertEquals(preguntaPorTotalRedondo(''), false);
  assertEquals(preguntaPorTotalRedondo(null), false);
});

Deno.test('drayage total redondo: FL ya incluye el regreso en la tarifa de tabla — no hay total adicional que sumar', () => {
  const outcome = resolveDrayageQuote({ destinoRaw: 'Pompano Beach', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  assertEquals(outcome.calculo.precioIncluyeRegreso, true);
  const out = buildDrayageRoundTripMarkdown(outcome.calculo);
  assertStringIncludes(out, 'ya incluye');
  assertEquals(out.includes('HIPÓTESIS'), false); // FL: no es hipótesis, es la tarifa real
});

Deno.test('drayage total redondo: TX NO incluye el regreso — el total se declara como hipótesis (tarifa × 2 aprox.)', () => {
  const outcome = resolveDrayageQuote({ destinoRaw: 'Houston', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  assertEquals(outcome.calculo.precioIncluyeRegreso, false);
  const out = buildDrayageRoundTripMarkdown(outcome.calculo);
  assertStringIncludes(out, formatUSD(950 * 2));
  assertStringIncludes(out, 'HIPÓTESIS');
});

// ─────────────────────────────────────────────────────────────────────────────
// TRAMOS CORTOS — reglas-v3-multiestado Fase 4 (kickoff §7, Decisión 4, criterio
// 13). El mínimo de referencia de v3 §7 (bucket 50-100mi: $500 piso / $650
// objetivo, el único bucket "de arranque" aprobado en la lectura crítica del
// PDF, sección E) aplica también POR DEBAJO de 100mi como piso fijo — no se
// escala por RPM cuando el tramo es corto (el cálculo por milla no tiene
// sentido económico a esa distancia). Se aplica SOLO al camino genérico (sin
// tabla): drayage sin tabla usa su propio benchmark, sin cambios en esta tarea.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('tramo corto: constantes de referencia v3 §7 (bucket 50-100mi, aprobado en la lectura crítica sección E)', () => {
  assertEquals(SHORT_HAUL_MILES_THRESHOLD, 100);
  assertEquals(SHORT_HAUL_FLOOR, 500);
  assertEquals(SHORT_HAUL_TARGET, 650);
});

Deno.test('tramo corto: un van de 60 millas devuelve el mínimo de 100 millas como piso (criterio 13)', () => {
  const dryVan = EQUIPMENT_BENCHMARKS.find(e => e.id === 'dry_van')!;
  const outcome = resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 60, pagoCamionRpm: null, tarifaOfrecida: null });
  assertEquals(outcome.kind, 'quote');
  if (outcome.kind !== 'quote') throw new Error('unreachable');
  assertEquals(outcome.calculo.piso, 500);
  assertEquals(outcome.calculo.floorSource, 'tramo_corto');
  assertEquals(outcome.calculo.objetivo, 650);
  assertEquals(outcome.calculo.targetSource, 'tramo_corto');
});

Deno.test('tramo corto: aplica también muy por debajo (10mi, el límite de sanidad) — no solo cerca de 100', () => {
  const dryVan = EQUIPMENT_BENCHMARKS.find(e => e.id === 'dry_van')!;
  const outcome = resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 10, pagoCamionRpm: null, tarifaOfrecida: null });
  if (outcome.kind !== 'quote') throw new Error('unreachable');
  assertEquals(outcome.calculo.objetivo, 650);
  assertEquals(outcome.calculo.piso, 500);
});

Deno.test('tramo corto: a partir de 100mi manda el cálculo por RPM, no el mínimo de tramo corto', () => {
  const dryVan = EQUIPMENT_BENCHMARKS.find(e => e.id === 'dry_van')!;
  const outcome = resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 100, pagoCamionRpm: null, tarifaOfrecida: null });
  if (outcome.kind !== 'quote') throw new Error('unreachable');
  assertEquals(outcome.calculo.targetSource, 'calculo');
  assertEquals(outcome.calculo.objetivo, 301); // round(3.01 × 100)
});

Deno.test('tramo corto: el dato del usuario (lo que le paga al camión) sigue ganando sobre el mínimo genérico', () => {
  const dryVan = EQUIPMENT_BENCHMARKS.find(e => e.id === 'dry_van')!;
  const outcome = resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 60, pagoCamionRpm: 10, tarifaOfrecida: null });
  if (outcome.kind !== 'quote') throw new Error('unreachable');
  assertEquals(outcome.calculo.piso, 600); // round(10 × 60), dato de usuario > mínimo genérico de tramo corto
  assertEquals(outcome.calculo.floorSource, 'dato_usuario');
});

Deno.test('respuesta: tramo corto ofrece afinar el piso con el costo por día (criterio 13)', () => {
  const dryVan = EQUIPMENT_BENCHMARKS.find(e => e.id === 'dry_van')!;
  const outcome = resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 60, pagoCamionRpm: null, tarifaOfrecida: null });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  const out = buildRateCheckMarkdown(outcome.calculo);
  assertStringIncludes(out, formatUSD(500));
  assertStringIncludes(out, formatUSD(650));
  assertStringIncludes(out, 'costo por día');
});

// piso/objetivo: computeFloorTarget con tramoCorto explícito (unidad, no vía resolveGenericQuote)
Deno.test('piso/objetivo: computeFloorTarget con tramoCorto — bajo=piso, alto=objetivo (Decisión 5)', () => {
  const r = computeFloorTarget({
    tablaPiso: null, tablaObjetivo: null, targetEsDerivado: false,
    millasIda: 60, rpmBase: 3.01, pagoCamionRpm: null,
    tramoCorto: { floor: 500, target: 650 },
  });
  assertEquals(r, { floor: 500, floorSource: 'tramo_corto', target: 650, targetSource: 'tramo_corto' });
});

Deno.test('piso/objetivo: tramoCorto no aplica si hay tabla (la tabla siempre manda)', () => {
  const r = computeFloorTarget({
    tablaPiso: 200, tablaObjetivo: 300, targetEsDerivado: false,
    millasIda: 20, rpmBase: null, pagoCamionRpm: null,
    tramoCorto: { floor: 500, target: 650 },
  });
  assertEquals(r.target, 300);
  assertEquals(r.targetSource, 'tabla');
  assertEquals(r.floor, 200);
  assertEquals(r.floorSource, 'tabla');
});

// ─────────────────────────────────────────────────────────────────────────────
// ACCESORIALES — reglas-v3-multiestado Fase 5 (kickoff §7.6). Los del estado
// consultado; fallback por estado vecino EXPLÍCITAMENTE nombrado (nunca se
// hereda tarifa, solo accesoriales); filtrados por lo que el usuario mencionó.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('accesoriales: estado propio (FL/TX) trae su propia tabla, sin heredar', () => {
  const fl = resolveAccessorialsForState('FL', 'Miami');
  assertEquals(fl.estado, 'FL');
  assertEquals(fl.heredado, false);
  assertEquals(fl.items.length, 20);

  const tx = resolveAccessorialsForState('TX', 'Houston');
  assertEquals(tx.estado, 'TX');
  assertEquals(tx.heredado, false);
  assertEquals(tx.items.length, 7);
});

Deno.test('accesoriales: Georgia (sin tabla propia) hereda los de Florida y lo declara (criterio 14)', () => {
  const r = resolveAccessorialsForState(null, 'Savannah, Georgia');
  assertEquals(r.estado, 'FL');
  assertEquals(r.heredado, true);
  assertEquals(r.items.length, 20);
});

Deno.test('accesoriales: Oklahoma/Nuevo México/Luisiana/Arkansas heredan de Texas', () => {
  assertEquals(resolveAccessorialsForState(null, 'Tulsa, Oklahoma').estado, 'TX');
  assertEquals(resolveAccessorialsForState(null, 'New Orleans, Louisiana').estado, 'TX');
});

Deno.test('accesoriales: un estado sin tabla propia y sin vecino conocido NO inventa una fuente — declara vacío', () => {
  const r = resolveAccessorialsForState(null, 'Columbus, Ohio');
  assertEquals(r.estado, null);
  assertEquals(r.heredado, false);
  assertEquals(r.items, []);
});

Deno.test('accesoriales: filterAccessorialsByTriggers solo devuelve lo que el usuario mencionó', () => {
  const fl = resolveAccessorialsForState('FL', 'Miami');
  const filtrados = filterAccessorialsByTriggers(fl.items, ['reefer']);
  assert(filtrados.length >= 1);
  assert(filtrados.every(a => normalizeText(a.concepto).includes('reefer')));
});

Deno.test('accesoriales: sin triggers, no se muestra nada (evita el spam de 20 líneas en cada respuesta)', () => {
  const fl = resolveAccessorialsForState('FL', 'Miami');
  assertEquals(filterAccessorialsByTriggers(fl.items, []), []);
  assertEquals(filterAccessorialsByTriggers(fl.items, null), []);
  assertEquals(filterAccessorialsByTriggers(fl.items, undefined), []);
});

Deno.test('accesoriales: resolveDrayageQuote adjunta los accesoriales filtrados de Georgia declarando Florida como fuente', () => {
  const outcome = resolveDrayageQuote({
    destinoRaw: 'Savannah, Georgia',
    tamano: '40',
    millasIdaDeclaradas: 60,
    pagoCamionRpm: null,
    tarifaOfrecida: null,
    accessorialTriggers: ['reefer'],
  });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  assertExists(outcome.calculo.accesoriales);
  assertEquals(outcome.calculo.accesoriales!.estado, 'FL');
  assertEquals(outcome.calculo.accesoriales!.heredado, true);
  assert(outcome.calculo.accesoriales!.items.length >= 1);
});

Deno.test('respuesta: accesoriales heredados se declaran de qué estado vienen, pero la tarifa sigue siendo cálculo (criterio 14)', () => {
  const outcome = resolveDrayageQuote({
    destinoRaw: 'Savannah, Georgia',
    tamano: '40',
    millasIdaDeclaradas: 60,
    pagoCamionRpm: null,
    tarifaOfrecida: null,
    accessorialTriggers: ['reefer'],
  });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  const out = buildRateCheckMarkdown(outcome.calculo);
  assertStringIncludes(out, 'Florida');
  assertStringIncludes(out, 'Reefer');
  assertEquals(outcome.calculo.targetSource, 'calculo'); // nunca se usa la tarifa de Florida, solo sus accesoriales
});

Deno.test('accesoriales: sin triggers no se adjunta nada al CalculatedQuote (no null-vs-undefined ambiguo)', () => {
  const outcome = resolveDrayageQuote({ destinoRaw: 'Pompano Beach', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  assertEquals(outcome.calculo.accesoriales, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// FUEL SURCHARGE DE TEXAS — Decisión 13-C. 0-62%, separado, y NUNCA se suma al
// objetivo de tabla (ya viene incluido). Solo se advierte.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('fuel surcharge TX: nunca se suma al objetivo de tabla — el objetivo de Houston no cambia si se piden accesoriales', () => {
  const sinAccesoriales = resolveDrayageQuote({ destinoRaw: 'Houston', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null });
  const conAccesoriales = resolveDrayageQuote({ destinoRaw: 'Houston', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null, accessorialTriggers: ['fuel', 'combustible', 'surcharge'] });
  if (sinAccesoriales.kind !== 'quote' || conAccesoriales.kind !== 'quote') throw new Error('fixture inválido');
  assertEquals(sinAccesoriales.calculo.objetivo, 950);
  assertEquals(conAccesoriales.calculo.objetivo, 950); // el objetivo NUNCA cambia por pedir el fuel surcharge
});

Deno.test('respuesta: Houston con fuel surcharge pedido explícitamente avisa que ya está incluido, no se suma aparte', () => {
  const outcome = resolveDrayageQuote({
    destinoRaw: 'Houston',
    tamano: '40',
    millasIdaDeclaradas: null,
    pagoCamionRpm: null,
    tarifaOfrecida: null,
    accessorialTriggers: ['fuel surcharge'],
  });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  const out = buildRateCheckMarkdown(outcome.calculo);
  assertStringIncludes(out, 'Fuel Surcharge');
  assertStringIncludes(out, 'ya está incluido');
  assertEquals(out.includes('$1,900'), false); // nunca 950 × 2 ni ninguna suma sobre el objetivo
});

// ─────────────────────────────────────────────────────────────────────────────
// VEREDICTO POR PERFIL — reglas-v3-multiestado Fase 6, kickoff §7.7 / spec
// "Verdict Without Dollar Minimum, By Profile" / Decisión 10-B.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('margen: umbrales exactos ≥40 / 25-40 / <25 (kickoff §7.7)', () => {
  assertEquals(MARGIN_THRESHOLD_STRONG, 40);
  assertEquals(MARGIN_THRESHOLD_ACCEPTABLE, 25);
});

Deno.test('margen: ≥40% de margen es banda fuerte', () => {
  const v = computeMarginVerdict('pago_camion', 1400, 1000); // 40% exacto
  assertEquals(v.pctMargen, 40);
  assertEquals(v.band, 'fuerte');
  assertEquals(v.montoMargen, 400);
});

Deno.test('margen: entre 25% y 40% es banda ajustada', () => {
  const bajo = computeMarginVerdict('pago_camion', 1250, 1000); // 25%
  const alto = computeMarginVerdict('pago_camion', 1399, 1000); // 39.9%
  assertEquals(bajo.band, 'ajustado');
  assertEquals(alto.band, 'ajustado');
});

Deno.test('margen: menos de 25% es banda débil', () => {
  const v = computeMarginVerdict('costo_propio', 1200, 1000); // 20%
  assertEquals(v.band, 'debil');
  assertEquals(v.pctMargen, 20);
});

Deno.test('margen: costo base propio da 0% en vez de dividir por cero', () => {
  const v = computeMarginVerdict('costo_propio', 500, 0);
  assertEquals(v.pctMargen, 0);
  assertEquals(v.band, 'debil');
});

// Decisión 10-B: NO hay mínimo en dólares. Un monto absoluto chico con el
// MISMO porcentaje de margen debe caer en la MISMA banda que un monto grande
// — el porcentaje decide, nunca el monto por sí solo.
Deno.test('margen (Decisión 10-B): un monto absoluto chico con 40% de margen es igual de "fuerte" que uno grande — nunca se bloquea por ser poca plata', () => {
  const montoChico = computeMarginVerdict('pago_camion', 140, 100); // margen de solo $40
  const montoGrande = computeMarginVerdict('pago_camion', 140000, 100000); // margen de $40,000
  assertEquals(montoChico.band, 'fuerte');
  assertEquals(montoGrande.band, 'fuerte');
  assertEquals(montoChico.band, montoGrande.band);
});

Deno.test('margen (Decisión 10-B): el monto en dólares se muestra siempre, nunca decide la banda solo', () => {
  const v = computeMarginVerdict('pago_camion', 140, 100);
  assertEquals(v.montoMargen, 40);
  assertExists(v.pctMargen);
  // No existe ningún umbral en dólares en el tipo ni en la función — se
  // verifica por ausencia: computeMarginVerdict solo toma 3 argumentos
  // (base, tarifa, costoBase), ninguno es un "mínimo en dólares".
  assertEquals(computeMarginVerdict.length, 3);
});

Deno.test('perfil: sin pago_camion ni costo_propio, no hay veredicto de perfil (no se inventa un costo)', () => {
  const r = resolveProfileMarginVerdict({ tarifaOfrecida: 1500, millasIda: 500, pagoCamionRpm: null, costoPorMillaPropio: null });
  assertEquals(r.perfil, 'sin_dato');
  assertEquals(r.verdicts.length, 0);
  assertEquals(r.masRestrictivo, null);
});

Deno.test('perfil: sin tarifa ofrecida, no hay veredicto de perfil aunque haya costos declarados', () => {
  const r = resolveProfileMarginVerdict({ tarifaOfrecida: null, millasIda: 500, pagoCamionRpm: 2.0, costoPorMillaPropio: 1.8 });
  assertEquals(r.perfil, 'sin_dato');
  assertEquals(r.verdicts.length, 0);
});

Deno.test('perfil: solo pago_camion declarado → base "despachador"', () => {
  const r = resolveProfileMarginVerdict({ tarifaOfrecida: 1200, millasIda: 500, pagoCamionRpm: 2.0, costoPorMillaPropio: null });
  assertEquals(r.perfil, 'despachador');
  assertEquals(r.verdicts.length, 1);
  assertEquals(r.verdicts[0].base, 'pago_camion');
  assertEquals(r.verdicts[0].costoBase, 1000); // 2.0 × 500
});

Deno.test('perfil: solo costo_propio declarado → base "owner_operator"', () => {
  const r = resolveProfileMarginVerdict({ tarifaOfrecida: 1200, millasIda: 500, pagoCamionRpm: null, costoPorMillaPropio: 1.5 });
  assertEquals(r.perfil, 'owner_operator');
  assertEquals(r.verdicts.length, 1);
  assertEquals(r.verdicts[0].base, 'costo_propio');
  assertEquals(r.verdicts[0].costoBase, 750); // 1.5 × 500
});

Deno.test('perfil: AMBOS declarados → "carrier_pequeno", reporta las dos bases y señala la más restrictiva', () => {
  // pago_camion: costo 1000 → margen 20% (débil). costo_propio: costo 800 → margen 50% (fuerte).
  const r = resolveProfileMarginVerdict({ tarifaOfrecida: 1200, millasIda: 500, pagoCamionRpm: 2.0, costoPorMillaPropio: 1.6 });
  assertEquals(r.perfil, 'carrier_pequeno');
  assertEquals(r.verdicts.length, 2);
  assertExists(r.masRestrictivo);
  assertEquals(r.masRestrictivo?.base, 'pago_camion'); // la banda débil es la más restrictiva
  assertEquals(r.masRestrictivo?.band, 'debil');
});

Deno.test('perfil: carrier_pequeno nunca esconde la banda menos favorable — el más restrictivo siempre está entre los verdicts reportados', () => {
  const r = resolveProfileMarginVerdict({ tarifaOfrecida: 1200, millasIda: 500, pagoCamionRpm: 2.0, costoPorMillaPropio: 1.6 });
  assert(r.verdicts.includes(r.masRestrictivo!), 'el más restrictivo debe ser uno de los dos verdicts reportados, no un tercer valor inventado');
});

Deno.test('respuesta: buildMarginVerdictMarkdown no genera líneas sin datos de costo', () => {
  const r = resolveProfileMarginVerdict({ tarifaOfrecida: 1200, millasIda: 500, pagoCamionRpm: null, costoPorMillaPropio: null });
  assertEquals(buildMarginVerdictMarkdown(r), []);
});

Deno.test('respuesta: buildRateCheckMarkdown incluye el margen por perfil cuando hay tarifa ofrecida y pago al camión', () => {
  const outcome = resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 500, pagoCamionRpm: 2.0, tarifaOfrecida: 1400 });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  const out = buildRateCheckMarkdown(outcome.calculo);
  assertStringIncludes(out, 'Margen vs. lo que le pagás al camión');
  assertStringIncludes(out, '40.0%');
});

Deno.test('respuesta: buildRateCheckMarkdown reporta AMBAS bases para un carrier chico (drayage con match de tabla)', () => {
  const outcome = resolveDrayageQuote({
    destinoRaw: 'Houston', tamano: '40', millasIdaDeclaradas: null,
    pagoCamionRpm: 2.0, tarifaOfrecida: 1200, costoPorMillaPropio: 1.6,
  });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  const out = buildRateCheckMarkdown(outcome.calculo);
  assertStringIncludes(out, 'lo que le pagás al camión');
  assertStringIncludes(out, 'tu costo propio declarado');
  assertStringIncludes(out, 'más restrictiva');
});

Deno.test('respuesta: sin tarifa ofrecida, buildRateCheckMarkdown no menciona margen por perfil', () => {
  const outcome = resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 500, pagoCamionRpm: 2.0, tarifaOfrecida: null });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  const out = buildRateCheckMarkdown(outcome.calculo);
  assertEquals(out.includes('Margen vs.'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITERIO 15 — Ninguna salida menciona ni usa OO ni el margen de tabla.
// La columna OO y "Margen" (de la hoja de Excel) son un concepto DISTINTO del
// "margen por perfil" de la Fase 6 (que es tarifa vs. costo declarado por el
// usuario, no una columna de tabla) — este test verifica que esas dos
// columnas de Excel nunca aparecen en NINGÚN texto generado, en ningún
// escenario representativo.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('criterio 15: ninguna salida generada menciona la columna OO ni "Margen" de tabla', () => {
  const escenarios: string[] = [
    buildRateCheckMarkdown(getQuote(resolveDrayageQuote({ destinoRaw: 'Pompano Beach', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: 500 }))),
    buildRateCheckMarkdown(getQuote(resolveDrayageQuote({ destinoRaw: 'Houston', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: 2.0, tarifaOfrecida: 900, costoPorMillaPropio: 1.5 }))),
    buildRateCheckMarkdown(getQuote(resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 420, pagoCamionRpm: 2.5, tarifaOfrecida: 1200 }))),
    buildAskMilesMarkdown('Pompano Beach'),
    buildMissingDataMarkdown(),
    buildSanityCapMarkdown(),
    buildOffTopicMarkdown(),
    buildEquipmentQuestionMarkdown('size'),
    buildEquipmentQuestionMarkdown('missing'),
  ];
  for (const texto of escenarios) {
    // Límite de palabra: "OO" como token propio, no dentro de otra palabra
    // (p. ej. "Piso" no debe hacer falso positivo).
    assertEquals(/\bOO\b/.test(texto), false, `no debe mencionar la columna OO: "${texto}"`);
    assertEquals(/\bMargen\b/i.test(texto) === false || /Margen vs\./.test(texto), true, `si aparece "margen" debe ser el veredicto por perfil (Fase 6), nunca la columna de tabla: "${texto}"`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITERIO 16 — Ninguna respuesta usa lenguaje imperativo (de orden/mandato).
// El alcance es el mismo que ya fijó TRUCKY-53 para el veredicto ("el label
// es una sugerencia, no una orden"): NO formas de mandato tipo "debés/debes",
// "tenés que/tienes que", "hay que". No confundir con imperativos
// conversacionales de pedir un dato ("decime las millas") — eso es un pedido
// de información preexistente, no una orden sobre la decisión de negocio del
// usuario, y no es lo que este criterio prohíbe.
// ─────────────────────────────────────────────────────────────────────────────

const IMPERATIVE_COMMAND_TOKENS = ['debes', 'debés', 'tenés que', 'tienes que', 'hay que', 'deberías', 'debe rechazar', 'debe aceptar'];

Deno.test('criterio 16: ningún build*Markdown genera lenguaje de mandato ("debes"/"tenés que"/"hay que")', () => {
  const escenarios: string[] = [
    buildRateCheckMarkdown(getQuote(resolveDrayageQuote({ destinoRaw: 'Pompano Beach', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: 500 }))),
    buildRateCheckMarkdown(getQuote(resolveDrayageQuote({ destinoRaw: 'Houston', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: 2.0, tarifaOfrecida: 900, costoPorMillaPropio: 1.5 }))),
    buildRateCheckMarkdown(getQuote(resolveGenericQuote({ equipment: dryVan, millasIdaDeclaradas: 420, pagoCamionRpm: 2.5, tarifaOfrecida: 1200 }))),
    buildRateCheckMarkdown(getQuote(resolveDrayageQuote({ destinoRaw: 'Fake City, Florida', tamano: '40', millasIdaDeclaradas: 90, pagoCamionRpm: null, tarifaOfrecida: null }))),
    buildAskMilesMarkdown('Pompano Beach'),
    buildMissingDataMarkdown(),
    buildSanityCapMarkdown(),
    buildOffTopicMarkdown(),
    buildEquipmentQuestionMarkdown('size'),
    buildEquipmentQuestionMarkdown('missing'),
  ];
  for (const texto of escenarios) {
    const normalizado = normalizeText(texto);
    for (const token of IMPERATIVE_COMMAND_TOKENS) {
      assertEquals(normalizado.includes(normalizeText(token)), false, `no debe usar lenguaje de mandato ("${token}"): "${texto}"`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// VEREDICTO
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('veredicto: sin oferta es solo referencia', () => {
  assertEquals(computeVerdict(null, 1000, 1500).band, 'reference');
  assertEquals(computeVerdict(null, 1000, 1500).label, 'REFERENCIA');
});

Deno.test('veredicto: bajo el piso se rechaza', () => {
  assertEquals(computeVerdict(999, 1000, 1500).band, 'reject');
  assertEquals(computeVerdict(999, 1000, 1500).label, 'TE SUGIERO PEDIR MÁS');
});

Deno.test('veredicto: entre piso y objetivo se negocia', () => {
  assertEquals(computeVerdict(1200, 1000, 1500).band, 'negotiate');
  assertEquals(computeVerdict(1499, 1000, 1500).band, 'negotiate');
});

Deno.test('veredicto: en o sobre el objetivo se acepta', () => {
  assertEquals(computeVerdict(1500, 1000, 1500).band, 'accept');
  assertEquals(computeVerdict(2000, 1000, 1500).band, 'accept');
});

Deno.test('veredicto: justo en el piso ya no se rechaza', () => {
  assertEquals(computeVerdict(1000, 1000, 1500).band, 'negotiate');
});

// NUEVO (Fase 3): floor puede ser null cuando no hay piso de tabla ni dato del
// usuario (FL sin CostConfig). Sin piso no se puede "rechazar por debajo del
// piso" — cae a comparar solo contra el objetivo.
Deno.test('veredicto: sin piso (null), nunca rechaza — compara contra el objetivo', () => {
  assertEquals(computeVerdict(100, null, 1500).band, 'negotiate');
  assertEquals(computeVerdict(2000, null, 1500).band, 'accept');
});

Deno.test('veredicto: encabezado de sugerencia — banda rechazo, sin lenguaje imperativo', () => {
  const verdict = computeVerdict(999, 1000, 1500);
  assertEquals(verdict.emoji, '🔴');
  assert(verdict.label.startsWith('TE SUGIERO'), 'el label debe empezar con "TE SUGIERO"');
  assertEquals(verdict.label.includes('debes'), false);
  assertEquals(verdict.label.includes('RECHAZAR'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEXTO Y FORMATO
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('formato: los montos van con separador de miles y sin decimales', () => {
  assertEquals(formatUSD(1400), '$1,400');
  assertEquals(formatUSD(400.6), '$401');
  assertEquals(formatUSD(0), '$0');
});

Deno.test('texto: la normalización quita acentos, espacios y mayúsculas', () => {
  assertEquals(normalizeText('  Bogotá  '), 'bogota');
  assertEquals(normalizeText('MIAMI'), 'miami');
  assertEquals(normalizeText(null), '');
  assertEquals(normalizeText(undefined), '');
});

Deno.test('texto: matchesAny encuentra cualquiera de los tokens', () => {
  assert(matchesAny('port everglades terminal', ['port everglades']));
  assertEquals(matchesAny('miami', ['tampa', 'orlando']), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// RESPUESTA ARMADA — reemplaza las pruebas basadas en el viejo RateCheckContext
// (laneLabel/source:'catalog'|'llm'/portEverglades/esRedondo/floorBasis/
// bucketRange) por el nuevo CalculatedQuote de resolveDrayageQuote/
// resolveGenericQuote. La regla de fondo no cambia: el desglose numérico
// siempre está presente (bug del PR #1 original).
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('respuesta: con tabla, una sola cifra — el objetivo de tabla, sin cálculo compitiendo (T-1)', () => {
  const outcome = resolveDrayageQuote({ destinoRaw: 'Pompano Beach', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  const out = buildRateCheckMarkdown(outcome.calculo);
  assertStringIncludes(out, 'Objetivo de tabla');
  assertStringIncludes(out, formatUSD(473));
  assertStringIncludes(out, 'Sin piso');
});

Deno.test('respuesta: un objetivo derivado se declara explícitamente como tal, nunca como tabla', () => {
  const outcome = resolveDrayageQuote({ destinoRaw: 'Houston', tamano: '45', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  const out = buildRateCheckMarkdown(outcome.calculo);
  assertStringIncludes(out, 'derivado del 40\'');
  assertStringIncludes(out, 'doble supuesto');
});

Deno.test('respuesta: una ruta ausente muestra las referencias etiquetadas como tal, nunca como precio de la ruta pedida', () => {
  const outcome = resolveDrayageQuote({ destinoRaw: 'Fake City, Florida', tamano: '40', millasIdaDeclaradas: 90, pagoCamionRpm: null, tarifaOfrecida: null });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  const out = buildRateCheckMarkdown(outcome.calculo);
  assertStringIncludes(out, 'Objetivo calculado');
  assertStringIncludes(out, 'Rutas cercanas de referencia en Florida');
  assertStringIncludes(out, 'no es una cotización de esta ruta');
  assertStringIncludes(out, 'Jupiter');
});

Deno.test('respuesta: una referencia lejana usa "valores de referencia general del mercado", sin nombrar el estado', () => {
  const outcome = resolveDrayageQuote({ destinoRaw: 'Columbus, Ohio', tamano: '40', millasIdaDeclaradas: 500, pagoCamionRpm: null, tarifaOfrecida: null });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  const out = buildRateCheckMarkdown(outcome.calculo);
  assertStringIncludes(out, 'referencia general del mercado');
  assertEquals(out.includes('Ohio'), false);
});

Deno.test('respuesta: con oferta trae el veredicto además del desglose', () => {
  const outcome = resolveDrayageQuote({ destinoRaw: 'Houston', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: 900 });
  if (outcome.kind !== 'quote') throw new Error('fixture inválido');
  const out = buildRateCheckMarkdown(outcome.calculo);
  assertStringIncludes(out, 'Te ofrecen');
  assertStringIncludes(out, formatUSD(900));
});

Deno.test('respuesta: buildAskMilesMarkdown nombra la ciudad conocida cuando existe', () => {
  const conCiudad = buildAskMilesMarkdown('Pompano Beach');
  const sinCiudad = buildAskMilesMarkdown(null);
  assertStringIncludes(conCiudad, 'Pompano Beach');
  assertEquals(sinCiudad.includes('Pompano Beach'), false);
});

Deno.test('respuesta: cuando faltan todos los datos pide aclaración en vez de inventar', () => {
  const out = buildMissingDataMarkdown();
  assertStringIncludes(out, 'Necesito más datos');
});

Deno.test('respuesta: una respuesta general vacía cae en el mensaje seguro', () => {
  assertEquals(buildGeneralMarkdown(''), safeFallbackContent());
  assertEquals(buildGeneralMarkdown('   '), safeFallbackContent());
  assertEquals(buildGeneralMarkdown(null), safeFallbackContent());
  assertEquals(buildGeneralMarkdown('  hola  '), 'hola');
});

// ─────────────────────────────────────────────────────────────────────────────
// ENTRADA
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('historial: se recortan los mensajes viejos y se conservan los últimos 8', () => {
  const doce = Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: `m${i}` }));
  const cap = capHistory(doce);
  assertEquals(cap.length, 8);
  assertEquals(cap[0].content, 'm4');
  assertEquals(cap[7].content, 'm11');
});

Deno.test('historial: menos mensajes que el tope pasan enteros', () => {
  const tres = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }];
  assertEquals(capHistory(tres).length, 3);
});

Deno.test('entrada: se rechaza cualquier forma inválida de mensajes', () => {
  assertEquals(isValidMessages([{ role: 'user', content: 'hola' }]), true);
  assertEquals(isValidMessages([]), false);
  assertEquals(isValidMessages(null), false);
  assertEquals(isValidMessages('hola'), false);
  assertEquals(isValidMessages([{ content: 'sin rol' }]), false);
  assertEquals(isValidMessages([{ role: 'user' }]), false);
  assertEquals(isValidMessages([{ role: 'user', content: 42 }]), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// GUARDARRAÍL DE TEMA — Decisión 1 (allowlist determinista de vocabulario KB).
// Feature preexistente, sin cambios de esta fase (ver nota de cabecera en
// rateEngine.ts). Pruebas intactas.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('tema: esConsultaDeNegocio reconoce vocabulario de negocio', () => {
  assert(esConsultaDeNegocio('¿cuánto está el diésel hoy?'), 'diésel debería reconocerse');
  assert(esConsultaDeNegocio('necesito saber qué es TWIC'), 'TWIC debería reconocerse');
  assert(esConsultaDeNegocio('¿qué es un chasis?'), 'chasis debería reconocerse');
});

Deno.test('tema: un mensaje sin vocabulario de negocio no es consulta de negocio', () => {
  assertEquals(esConsultaDeNegocio('cuéntame un chiste'), false);
  assertEquals(esConsultaDeNegocio('¿cómo está el clima hoy?'), false);
  assertEquals(esConsultaDeNegocio(''), false);
  assertEquals(esConsultaDeNegocio(null), false);
  assertEquals(esConsultaDeNegocio(undefined), false);
});

Deno.test('tema: ultimoMensajeDelDispatcher toma el último mensaje de role user', () => {
  const msgs: Array<{ role: string; content: string }> = [
    { role: 'user', content: 'primero' },
    { role: 'assistant', content: 'respuesta' },
    { role: 'user', content: 'último' },
  ];
  assertEquals(ultimoMensajeDelDispatcher(msgs), 'último');
  assertEquals(ultimoMensajeDelDispatcher([]), '');
  assertEquals(ultimoMensajeDelDispatcher([{ role: 'assistant', content: 'solo bot' }]), '');
});

Deno.test('tema: resolveIntent — rate_check explícito siempre gana', () => {
  assertEquals(resolveIntent('rate_check', [{ role: 'user', content: 'cuéntame un chiste' }]), 'rate_check');
});

Deno.test('tema: resolveIntent — la allowlist de negocio rescata intent=off_topic', () => {
  assertEquals(resolveIntent('off_topic', [{ role: 'user', content: '¿cuánto está el diésel?' }]), 'general');
  assertEquals(resolveIntent('general', [{ role: 'user', content: '¿qué es TWIC?' }]), 'general');
});

Deno.test('tema: resolveIntent — off_topic explícito sin vocabulario de negocio se declina', () => {
  assertEquals(resolveIntent('off_topic', [{ role: 'user', content: 'cuéntame un chiste' }]), 'off_topic');
});

Deno.test('tema: resolveIntent — cualquier otro caso cae en general', () => {
  assertEquals(resolveIntent('general', [{ role: 'user', content: 'hola, ¿cómo estás?' }]), 'general');
  assertEquals(resolveIntent(undefined, [{ role: 'user', content: 'hola' }]), 'general');
});

Deno.test('tema: buildOffTopicMarkdown declina en 2 líneas exactas, sin cifras', () => {
  const out = buildOffTopicMarkdown();
  const lineas = out.split('\n');
  assertEquals(lineas.length, 2);
  assertStringIncludes(out, 'freight');
  assertStringIncludes(out, 'sur de Florida');
  assertEquals(/\$\d/.test(out), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCKLIST DE DEMO — capa temporal detrás de la allowlist. Sin cambios.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('tema-blocklist: esFueraDeTema detecta las 8 categorías de demo', () => {
  assert(esFueraDeTema('escribe un script de python que ordene una lista'), 'programación');
  assert(esFueraDeTema('¿cómo está el clima hoy?'), 'clima');
  assert(esFueraDeTema('¿quién ganó el partido de fútbol de ayer?'), 'deportes');
  assert(esFueraDeTema('dame una receta de arroz con pollo'), 'recetas');
  assert(esFueraDeTema('¿qué opinas de las elecciones?'), 'política');
  assert(esFueraDeTema('¿cuánto es 15% de 2400?'), 'aritmética pura');
  assert(esFueraDeTema("traduce 'hello' al español"), 'traducción');
  assert(esFueraDeTema('cuéntame un chiste'), 'chistes');
});

Deno.test('tema-blocklist: la allowlist de negocio siempre gana sobre el blocklist', () => {
  assertEquals(esFueraDeTema('¿cuánto es 15% de una carga de $2,400?'), false);
  assertEquals(esFueraDeTema('necesito un chiste sobre el TWIC'), false);
});

Deno.test('tema-blocklist: sin evidencia de las 8 categorías no bloquea', () => {
  assertEquals(esFueraDeTema('hola, ¿cómo estás?'), false);
  assertEquals(esFueraDeTema(''), false);
  assertEquals(esFueraDeTema(null), false);
});

Deno.test('tema-blocklist: resolveIntent — rate_check gana incluso sobre el blocklist', () => {
  assertEquals(resolveIntent('rate_check', [{ role: 'user', content: 'cuéntame un chiste' }]), 'rate_check');
});

Deno.test('tema-blocklist: resolveIntent — declina cuando ni el LLM ni la allowlist rescatan', () => {
  assertEquals(resolveIntent('general', [{ role: 'user', content: 'cuéntame un chiste' }]), 'off_topic');
});
