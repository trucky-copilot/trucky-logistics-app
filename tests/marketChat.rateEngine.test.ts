// ─────────────────────────────────────────────────────────────────────────────
// Pruebas del motor de tarifas del Chat de Mercado.
//
// Cubren las funciones puras de base44/functions/marketChat/rateEngine.ts.
// Viven FUERA del directorio de la función a propósito: Base44 despliega ese
// directorio completo, y no queremos subir código de prueba a producción.
//
// Correr con:  npm run test:functions
//
// Estas pruebas afirman el comportamiento ACTUAL. Si alguna falla después de un
// cambio, el cambio rompió un cálculo que antes funcionaba. La única excepción
// está marcada explícitamente abajo (TRUCKY-48).
// ─────────────────────────────────────────────────────────────────────────────

import {
  assertEquals,
  assertStringIncludes,
  assert,
} from 'jsr:@std/assert@1';

import type { RateCheckContext } from '../base44/functions/marketChat/rateEngine.ts';
import {
  EQUIPMENT_BENCHMARKS,
  FLAT_MINIMUMS,
  PORT_EVERGLADES_SURCHARGE,
  DETENTION,
  normalizeText,
  matchesAny,
  findLane,
  resolveMiles,
  resolveEquipment,
  buildEquipmentQuestionMarkdown,
  getFlatBucket,
  computeFloor,
  computeTarget,
  computeVerdict,
  resolveFloorBasis,
  formatUSD,
  buildRateCheckMarkdown,
  buildGeneralMarkdown,
  buildMissingDataMarkdown,
  buildOutOfMarketMarkdown,
  detectarFueraDeMercado,
  safeFallbackContent,
  capHistory,
  isValidMessages,
  esConsultaDeNegocio,
  ultimoMensajeDelDispatcher,
  resolveIntent,
  buildOffTopicMarkdown,
  esFueraDeTema,
} from '../base44/functions/marketChat/rateEngine.ts';

import type { Locale } from '../base44/functions/marketChat/messageCatalog.ts';
import {
  MESSAGES,
  render,
  collectStaticFragments,
  resolveLocale,
} from '../base44/functions/marketChat/messageCatalog.ts';

// ─────────────────────────────────────────────────────────────────────────────
// CATÁLOGO DE MENSAJES — bootstrap del módulo (chat-idioma-toggle, Fase 1A).
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('messageCatalog: es/en tienen el mismo árbol de claves', () => {
  // Recorre el árbol y devuelve solo la FORMA (claves), nunca el contenido de
  // las hojas — así la prueba de paridad no se acopla a la redacción.
  const keysTree = (node: unknown): unknown => {
    if (typeof node === 'string') return null;
    if (node && typeof node === 'object' && Array.isArray((node as { parts?: unknown }).parts)) return null;
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(node as Record<string, unknown>).sort()) {
        out[k] = keysTree((node as Record<string, unknown>)[k]);
      }
      return out;
    }
    return null;
  };
  assertEquals(keysTree(MESSAGES.es), keysTree(MESSAGES.en));
});

Deno.test('render: hoja string devuelve el string', () => {
  assertEquals(render('hola'), 'hola');
});

Deno.test('render: hoja {parts} concatena e interpola argumentos', () => {
  assertEquals(render({ parts: ['a-', '-b-', '-c'] }, 'X', 'Y'), 'a-X-b-Y-c');
  assertEquals(render({ parts: ['solo'] }), 'solo');
});

Deno.test('collectStaticFragments: recorre el árbol y filtra fragmentos <3 chars no-espacio', () => {
  const tree = {
    dominio: {
      corto: '· ',
      largo: 'hola mundo',
      hoja: { parts: ['ab', 'cde'] },
    },
  };
  const fragments = collectStaticFragments(tree);
  assertEquals(fragments.includes('hola mundo'), true);
  assertEquals(fragments.includes('cde'), true);
  assertEquals(fragments.includes('· '), false);
  assertEquals(fragments.includes('ab'), false);
});

Deno.test("resolveLocale: allowlist ['es','en'], default 'es' ante undefined/inválido/tipo incorrecto", () => {
  assertEquals(resolveLocale('es'), 'es');
  assertEquals(resolveLocale('en'), 'en');
  assertEquals(resolveLocale(undefined), 'es');
  assertEquals(resolveLocale('fr'), 'es');
  assertEquals(resolveLocale(123), 'es');
  assertEquals(resolveLocale(null), 'es');
});

// ─────────────────────────────────────────────────────────────────────────────
// DATOS DE REFERENCIA — si alguien cambia un número de la tabla, esto falla y
// dice cuál. Es el criterio 3 del ticket TRUCKY-50.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('datos: los 7 equipos conservan sus benchmarks', () => {
  assertEquals(EQUIPMENT_BENCHMARKS.length, 7);
  const porId = Object.fromEntries(EQUIPMENT_BENCHMARKS.map(e => [e.id, e]));
  assertEquals(porId.dry_van.rpm_min, 2.00);
  assertEquals(porId.dry_van.rpm_target, 2.50);
  assertEquals(porId.reefer.rpm_min, 2.30);
  assertEquals(porId.flatbed.rpm_min, 2.50);
  assertEquals(porId.step_deck.rpm_min, 2.75);
  assertEquals(porId.drayage_20.rpm_min, 2.75);
  assertEquals(porId.drayage_20.rpm_target, 3.50);
  assertEquals(porId.drayage_40.rpm_min, 2.50);
  assertEquals(porId.power_only.rpm_min, 1.50);
});

Deno.test('datos: los 7 tramos de mínimo flat conservan sus valores', () => {
  assertEquals(FLAT_MINIMUMS.length, 7);
  assertEquals(FLAT_MINIMUMS[0].min, 400);
  assertEquals(FLAT_MINIMUMS[1].min, 500);
  assertEquals(FLAT_MINIMUMS[2].min, 650);
  assertEquals(FLAT_MINIMUMS[3].min, 900);
  assertEquals(FLAT_MINIMUMS[4].min, 1400);
  assertEquals(FLAT_MINIMUMS[5].min, 1800);
  assertEquals(FLAT_MINIMUMS[6].min, 2400);
  assertEquals(FLAT_MINIMUMS[6].max, null);
});

Deno.test('datos: el detention tiene un solo valor estándar', () => {
  assertEquals(DETENTION.standard, 75);
  assertEquals(DETENTION.min, 50);
  assertEquals(DETENTION.max, 100);
  assertEquals(DETENTION.free_hours, 2);
});

Deno.test('datos: el recargo de Port Everglades es $50', () => {
  assertEquals(PORT_EVERGLADES_SURCHARGE, 50);
});

// ─────────────────────────────────────────────────────────────────────────────
// EL PISO — la regla de oro: el mayor entre el mínimo del tramo y RPM × millas.
// Es el bug que corrigió el PR #1 (cotizaba $99 una ruta de 18 millas).
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('piso: en ruta corta manda el mínimo del tramo, no el cálculo por milla', () => {
  // 18 mi redondo en dry van: 2.00 × 18 = $36. El tramo <50 mi exige $400.
  const bucket = getFlatBucket(18);
  assertEquals(computeFloor(18, 2.00, bucket.min), 400);
});

Deno.test('piso: en ruta larga manda el cálculo por milla', () => {
  // 900 mi en drayage 20': 2.75 × 900 = $2.475 > los $2.400 del tramo 800+.
  const bucket = getFlatBucket(900);
  assertEquals(computeFloor(900, 2.75, bucket.min), 2475);
});

Deno.test('piso: Miami-Tampa en dry van lo gobierna el tramo', () => {
  // 540 mi: 2.00 × 540 = $1.080 < los $1.400 del tramo 400-600.
  const bucket = getFlatBucket(540);
  assertEquals(computeFloor(540, 2.00, bucket.min), 1400);
});

Deno.test('piso: el recargo de Port Everglades se suma al final', () => {
  const bucket = getFlatBucket(136);
  assertEquals(computeFloor(136, 2.00, bucket.min), 650);
  assertEquals(computeFloor(136, 2.00, bucket.min, PORT_EVERGLADES_SURCHARGE), 700);
});

Deno.test('objetivo: usa el máximo del tramo y el RPM objetivo', () => {
  const corto = getFlatBucket(18);
  assertEquals(computeTarget(18, 2.50, corto.max), 500);
  const largo = getFlatBucket(900);
  // El tramo 800+ no tiene máximo: manda el cálculo por milla.
  assertEquals(computeTarget(900, 3.50, largo.max), 3150);
});

// ─────────────────────────────────────────────────────────────────────────────
// TRAMOS — los bordes exactos, que es donde se cometen los errores.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('tramos: los bordes caen en el tramo correcto', () => {
  assertEquals(getFlatBucket(0).range, '<50 mi');
  assertEquals(getFlatBucket(49).range, '<50 mi');
  assertEquals(getFlatBucket(50).range, '50–100 mi');
  assertEquals(getFlatBucket(99).range, '50–100 mi');
  assertEquals(getFlatBucket(100).range, '100–200 mi');
  assertEquals(getFlatBucket(199).range, '100–200 mi');
  assertEquals(getFlatBucket(200).range, '200–400 mi');
  assertEquals(getFlatBucket(399).range, '200–400 mi');
  assertEquals(getFlatBucket(400).range, '400–600 mi');
  assertEquals(getFlatBucket(599).range, '400–600 mi');
  assertEquals(getFlatBucket(600).range, '600–800 mi');
  assertEquals(getFlatBucket(799).range, '600–800 mi');
  assertEquals(getFlatBucket(800).range, '800+ mi');
  assertEquals(getFlatBucket(5000).range, '800+ mi');
});

// ─────────────────────────────────────────────────────────────────────────────
// EQUIPO
// ─────────────────────────────────────────────────────────────────────────────

// TEST INVERSION 1/7 (TRUCKY-48 F2-09): antes afirmaba
// ResolvedEquipment.was_defaulted === false para los 7 ids; ahora
// normalizeEquipment ya no existe — el nuevo shape es EquipmentResolution, y un
// id válido del benchmark siempre resuelve 'ok' con ese equipo exacto.
Deno.test('equipo: los 7 ids válidos se resuelven sin asumir nada', () => {
  for (const e of EQUIPMENT_BENCHMARKS) {
    const r = resolveEquipment(e.id);
    assertEquals(r.status, 'ok');
    if (r.status === 'ok') assertEquals(r.equipment.id, e.id);
  }
});

// TEST INVERSION 2/7 (TRUCKY-48 F2-09): antes un id desconocido caía en dry van
// marcado was_defaulted=true; ahora se pregunta — nunca se sustituye un equipo.
Deno.test('equipo: un id desconocido pide el equipo en vez de asumir dry van', () => {
  const r = resolveEquipment('unknown');
  assertEquals(r.status, 'ask');
  if (r.status === 'ask') assertEquals(r.reason, 'missing');
});

// TEST INVERSION 3/7 (TRUCKY-48 F2-09): antes sin dato caía en dry van con el
// sufijo " (asumido dry van)" en la respuesta armada; ahora pide el equipo y
// ningún texto renderizado contiene la palabra "asumido".
Deno.test('equipo: sin dato pide el equipo en vez de asumir dry van', () => {
  for (const raw of [undefined, null, '']) {
    const r = resolveEquipment(raw);
    assertEquals(r.status, 'ask');
    if (r.status === 'ask') assertEquals(r.reason, 'missing');
  }
});

// TEST INVERSION 4/7 — TRUCKY-48 (F2-09) CORREGIDO.
// Esta prueba antes documentaba el defecto a propósito: "drayage" a secas caía
// en dry van y subvaluaba el piso ($2.00/mi en vez de $2.50-$2.75). Ahora prueba
// el arreglo: "drayage" a secas nunca cotiza como dry van, pide el tamaño del
// contenedor. Si esta prueba falla sola después de un cambio futuro, es que
// alguien reintrodujo el default silencioso — eso también es información útil.
Deno.test('equipo: TRUCKY-48 corregido — "drayage" a secas pide el tamaño, no cae en dry van', () => {
  const r = resolveEquipment('drayage');
  assertEquals(r.status, 'ask');
  if (r.status === 'ask') assertEquals(r.reason, 'size');
});

// ─────────────────────────────────────────────────────────────────────────────
// MILLAS Y RUTAS
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('millas: el catálogo gana sobre la estimación de la IA', () => {
  const r = resolveMiles('Miami', 'Tampa', 999, true);
  assertEquals(r.miles, 540);
  assertEquals(r.source, 'catalog');
  assertEquals(r.lane_label, 'Miami ↔ Tampa');
  assertEquals(r.insufficient, false);
});

Deno.test('millas: redondo es el comportamiento por defecto', () => {
  assertEquals(resolveMiles('Miami', 'Tampa', null, undefined).miles, 540);
});

Deno.test('millas: "solo ida" divide el trayecto del catálogo', () => {
  assertEquals(resolveMiles('Miami', 'Tampa', null, false).miles, 270);
});

Deno.test('rutas: los alias del catálogo se reconocen', () => {
  assertEquals(resolveMiles('Miami', 'WPB', null, true).miles, 136);
  assertEquals(resolveMiles('Miami', 'jax', null, true).miles, 680);
  assertEquals(resolveMiles('Miami', 'ft myers', null, true).miles, 240);
  assertEquals(resolveMiles('Miami', 'pompano beach', null, true).miles, 70);
  assertEquals(resolveMiles('Miami', 'Fort Pierce', null, true).miles, 230);
  assertEquals(resolveMiles('Miami', 'Orlando', null, true).miles, 470);
});

Deno.test('rutas: la dirección no importa, el destino se detecta en cualquier extremo', () => {
  assertEquals(resolveMiles('Tampa', 'Miami', null, true).miles, 540);
});

Deno.test('millas: sin ruta catalogada usa la estimación de la IA y lo declara', () => {
  const r = resolveMiles('South Palm Beach', 'Wellington', 30, true);
  assertEquals(r.miles, 60);
  assertEquals(r.source, 'llm');
  assertEquals(r.lane_label, null);
});

Deno.test('millas: sin ruta y sin estimación NO inventa un piso', () => {
  const r = resolveMiles('Savannah', 'Atlanta', null, true);
  assertEquals(r.insufficient, true);
  assertEquals(r.miles, null);
});

Deno.test('millas: marca confianza baja fuera del rango de sanidad', () => {
  assert(resolveMiles('A', 'B', 2, true).low_confidence, 'debería marcar confianza baja bajo 10 mi');
  assert(resolveMiles('A', 'B', 2000, true).low_confidence, 'debería marcar confianza baja sobre 3000 mi');
  assertEquals(resolveMiles('A', 'B', 100, true).low_confidence, false);
});

Deno.test('rutas: Port Everglades activa el recargo y cuenta como zona base', () => {
  const r = resolveMiles('Port Everglades', 'Tampa', null, true);
  assertEquals(r.portEverglades, true);
  assertEquals(r.miles, 540);
});

Deno.test('rutas: dos extremos base no resuelven ninguna lane', () => {
  const r = findLane('Miami', 'Fort Lauderdale');
  assertEquals(r.lane, null);
  assertEquals(r.portEverglades, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// ALCANCE DEL MERCADO — el guardarraíl de honestidad de F2-03.
//
// Las dos mitades importan igual: que se niegue a cotizar fuera del mercado, y
// que NO se niegue dentro. Un guardarraíl que rechaza rutas legítimas de Florida
// sería peor que el defecto que corrige.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('mercado: rechaza el caso que reportó la revisión (Georgia)', () => {
  assertEquals(detectarFueraDeMercado('Savannah, Georgia', 'Atlanta'), 'georgia');
  assert(detectarFueraDeMercado('puerto de Savannah', 'Atlanta'), 'debería detectar Savannah');
  assert(detectarFueraDeMercado('Miami', 'Atlanta'), 'debería detectar Atlanta como plaza de fuera');
});

Deno.test('mercado: rechaza otros mercados nombrados por estado', () => {
  assert(detectarFueraDeMercado('Miami', 'Houston, Texas'));
  assert(detectarFueraDeMercado('Charleston, South Carolina', 'Miami'));
  assert(detectarFueraDeMercado('Miami', 'Newark, New Jersey'));
  assert(detectarFueraDeMercado('Los Angeles', 'Long Beach'));
});

Deno.test('mercado: NO rechaza las rutas del catálogo', () => {
  assertEquals(detectarFueraDeMercado('Miami', 'Tampa'), null);
  assertEquals(detectarFueraDeMercado('Miami', 'Orlando'), null);
  assertEquals(detectarFueraDeMercado('PortMiami', 'Jacksonville'), null);
  assertEquals(detectarFueraDeMercado('Port Everglades', 'Fort Myers'), null);
  assertEquals(detectarFueraDeMercado('Miami', 'WPB'), null);
});

Deno.test('mercado: NO rechaza rutas legítimas de Florida fuera del catálogo', () => {
  // Este es el caso que hace que el guardarraíl sea geográfico y no por catálogo.
  assertEquals(detectarFueraDeMercado('South Palm Beach', 'Wellington'), null);
  assertEquals(detectarFueraDeMercado('Doral', 'Homestead'), null);
  assertEquals(detectarFueraDeMercado('Medley', 'Boca Raton'), null);
});

Deno.test('mercado: una ciudad de Florida gana sobre su homónima de otro estado', () => {
  // "Hollywood" existe en Florida y en California; el marcador de Florida manda.
  assertEquals(detectarFueraDeMercado('Miami', 'Hollywood FL'), null);
  // Y Jacksonville es de Florida aunque haya otras en el país.
  assertEquals(detectarFueraDeMercado('Jacksonville, Florida', 'Miami'), null);
});

Deno.test('mercado: sin evidencia de estar fuera, se asume dentro', () => {
  // Preferimos cotizar una ruta local desconocida antes que negarnos a trabajar
  // en nuestro propio mercado.
  assertEquals(detectarFueraDeMercado('bodega del cliente', 'la terminal'), null);
  assertEquals(detectarFueraDeMercado(null, null), null);
  assertEquals(detectarFueraDeMercado('', ''), null);
});

Deno.test('mercado: los abreviados no coinciden dentro de otra palabra', () => {
  // "fit" es una terminal, pero no debe activarse dentro de "outfit".
  assertEquals(detectarFueraDeMercado('FIT terminal', 'Pompano'), null);
});

Deno.test('mercado: el mensaje de rechazo no entrega ninguna cifra de tarifa', () => {
  const out = buildOutOfMarketMarkdown('Savannah, Georgia', 'Atlanta', 'es');
  assertStringIncludes(out, 'No tengo tarifas de esa ruta');
  assertStringIncludes(out, 'sur de Florida');
  assertStringIncludes(out, 'Tampa');
  assertEquals(/\$\d/.test(out), false);

  const outEn = buildOutOfMarketMarkdown('Savannah, Georgia', 'Atlanta', 'en');
  assertStringIncludes(outEn, "don't have rates for that route");
  assertStringIncludes(outEn, 'South Florida');
  assertStringIncludes(outEn, 'Tampa');
  assertEquals(/\$\d/.test(outEn), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// VEREDICTO
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('veredicto: sin oferta es solo referencia', () => {
  assertEquals(computeVerdict(null, 1000, 1500, 'es').band, 'reference');
  assertEquals(computeVerdict(null, 1000, 1500, 'es').label, 'REFERENCIA');

  assertEquals(computeVerdict(null, 1000, 1500, 'en').band, 'reference');
  assertEquals(computeVerdict(null, 1000, 1500, 'en').label, 'REFERENCE');
});

// TRUCKY-53 Q5: el label deja de ser una orden imperativa ("RECHAZAR") y pasa a
// ser una sugerencia. El band (el semáforo) NO cambia — sigue siendo 'reject'.
Deno.test('veredicto: bajo el piso se rechaza', () => {
  assertEquals(computeVerdict(999, 1000, 1500, 'es').band, 'reject');
  assertEquals(computeVerdict(999, 1000, 1500, 'es').label, 'TE SUGIERO PEDIR MÁS');

  assertEquals(computeVerdict(999, 1000, 1500, 'en').band, 'reject');
  assertEquals(computeVerdict(999, 1000, 1500, 'en').label, 'I SUGGEST ASKING FOR MORE');
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

// TRUCKY-53 Q5 — encabezados de sugerencia, uno por banda. El semáforo (emoji +
// band) está congelado; lo único que cambia es que el label deja de ser una
// orden. Ninguna respuesta debe contener "debes" ni los labels imperativos
// viejos de otra banda.
Deno.test('veredicto: encabezado de sugerencia — banda rechazo', () => {
  const verdict = computeVerdict(999, 1000, 1500, 'es');
  assertEquals(verdict.emoji, '🔴');
  assert(verdict.label.startsWith('TE SUGIERO'), 'el label debe empezar con "TE SUGIERO"');
  const out = buildRateCheckMarkdown({ ...CTX_BASE, tarifaOfrecida: 999, floor: 1000, target: 1500 }, 'es');
  assertEquals(out.includes('debes'), false);
  assertEquals(out.includes('**RECHAZAR**'), false);
  assertEquals(out.includes('**ACEPTAR**'), false);
  assertEquals(out.includes('**NEGOCIAR**'), false);

  const verdictEn = computeVerdict(999, 1000, 1500, 'en');
  assertEquals(verdictEn.emoji, '🔴');
  assert(verdictEn.label.startsWith('I SUGGEST'), 'the label should start with "I SUGGEST"');
  const outEn = buildRateCheckMarkdown({ ...CTX_BASE, tarifaOfrecida: 999, floor: 1000, target: 1500 }, 'en');
  assertEquals(outEn.includes('must'), false);
  assertEquals(outEn.includes('**REJECT**'), false);
  assertEquals(outEn.includes('**ACCEPT**'), false);
  assertEquals(outEn.includes('**NEGOTIATE**'), false);
});

Deno.test('veredicto: encabezado de sugerencia — banda negociar', () => {
  const verdict = computeVerdict(1200, 1000, 1500, 'es');
  assertEquals(verdict.emoji, '🟡');
  assert(verdict.label.startsWith('TE SUGIERO'), 'el label debe empezar con "TE SUGIERO"');
  const out = buildRateCheckMarkdown({ ...CTX_BASE, tarifaOfrecida: 1200, floor: 1000, target: 1500 }, 'es');
  assertEquals(out.includes('debes'), false);
  assertEquals(out.includes('**RECHAZAR**'), false);
  assertEquals(out.includes('**ACEPTAR**'), false);
  assertEquals(out.includes('**NEGOCIAR**'), false);

  const verdictEn = computeVerdict(1200, 1000, 1500, 'en');
  assertEquals(verdictEn.emoji, '🟡');
  assert(verdictEn.label.startsWith('I SUGGEST'), 'the label should start with "I SUGGEST"');
  const outEn = buildRateCheckMarkdown({ ...CTX_BASE, tarifaOfrecida: 1200, floor: 1000, target: 1500 }, 'en');
  assertEquals(outEn.includes('must'), false);
  assertEquals(outEn.includes('**REJECT**'), false);
  assertEquals(outEn.includes('**ACCEPT**'), false);
  assertEquals(outEn.includes('**NEGOTIATE**'), false);
});

Deno.test('veredicto: encabezado de sugerencia — banda aceptar', () => {
  const verdict = computeVerdict(2000, 1000, 1500, 'es');
  assertEquals(verdict.emoji, '🟢');
  assert(verdict.label.startsWith('TE SUGIERO'), 'el label debe empezar con "TE SUGIERO"');
  const out = buildRateCheckMarkdown({ ...CTX_BASE, tarifaOfrecida: 2000, floor: 1000, target: 1500 }, 'es');
  assertEquals(out.includes('debes'), false);
  assertEquals(out.includes('**RECHAZAR**'), false);
  assertEquals(out.includes('**ACEPTAR**'), false);
  assertEquals(out.includes('**NEGOCIAR**'), false);

  const verdictEn = computeVerdict(2000, 1000, 1500, 'en');
  assertEquals(verdictEn.emoji, '🟢');
  assert(verdictEn.label.startsWith('I SUGGEST'), 'the label should start with "I SUGGEST"');
  const outEn = buildRateCheckMarkdown({ ...CTX_BASE, tarifaOfrecida: 2000, floor: 1000, target: 1500 }, 'en');
  assertEquals(outEn.includes('must'), false);
  assertEquals(outEn.includes('**REJECT**'), false);
  assertEquals(outEn.includes('**ACCEPT**'), false);
  assertEquals(outEn.includes('**NEGOTIATE**'), false);
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
// RESPUESTA ARMADA — el desglose numérico siempre presente (bug del PR #1).
// ─────────────────────────────────────────────────────────────────────────────

// TEST ADAPTATION 7/7 (TRUCKY-48 F2-09): CTX_BASE.equipment usaba
// normalizeEquipment (que ya no existe); ahora usa un Equipment plano, resuelto
// con resolveEquipment y desempaquetado desde el shape 'ok'.
function equipoOk(id: string) {
  const r = resolveEquipment(id);
  if (r.status !== 'ok') throw new Error(`fixture de prueba inválido: '${id}' no resuelve 'ok'`);
  return r.equipment;
}

const CTX_BASE: RateCheckContext = {
  origen: 'Miami',
  destino: 'Tampa',
  miles: 540,
  esRedondo: true,
  laneLabel: 'Miami ↔ Tampa',
  source: 'catalog',
  lowConfidence: false,
  equipment: equipoOk('dry_van'),
  floor: 1400,
  target: 1800,
  tarifaOfrecida: null,
  portEverglades: false,
  floorBasis: 'flat',
  bucketRange: '400–600 mi',
};

Deno.test('respuesta: sin oferta muestra piso y objetivo como referencia', () => {
  const out = buildRateCheckMarkdown(CTX_BASE, 'es');
  assertStringIncludes(out, 'REFERENCIA');
  assertStringIncludes(out, 'Piso: $1,400');
  assertStringIncludes(out, 'Objetivo: $1,800');

  const outEn = buildRateCheckMarkdown(CTX_BASE, 'en');
  assertStringIncludes(outEn, 'REFERENCE');
  assertStringIncludes(outEn, 'Floor: $1,400');
  assertStringIncludes(outEn, 'Target: $1,800');
});

Deno.test('respuesta: con oferta siempre trae el desglose completo', () => {
  const out = buildRateCheckMarkdown({ ...CTX_BASE, tarifaOfrecida: 1000 }, 'es');
  assertStringIncludes(out, 'TE SUGIERO PEDIR MÁS');
  assertStringIncludes(out, 'Piso: $1,400');
  assertStringIncludes(out, 'Ofrecen $1,000');
  assertStringIncludes(out, '/mi');
  assertStringIncludes(out, 'diferencia');

  const outEn = buildRateCheckMarkdown({ ...CTX_BASE, tarifaOfrecida: 1000 }, 'en');
  assertStringIncludes(outEn, 'I SUGGEST ASKING FOR MORE');
  assertStringIncludes(outEn, 'Floor: $1,400');
  assertStringIncludes(outEn, 'offering $1,000');
  assertStringIncludes(outEn, '/mi');
  assertStringIncludes(outEn, 'difference');
});

// ─────────────────────────────────────────────────────────────────────────────
// LA CONTRADICCIÓN EN PANTALLA — hallazgo de la revisión sobre F2-00.
// El cálculo del piso siempre estuvo bien; lo que confundía era mostrar una
// referencia por milla al lado de una cifra que no salió de ella.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('base del piso: el tramo manda en ruta corta y el RPM en ruta larga', () => {
  // 30 mi en dry van: el tramo <50 exige $400 contra $60 del cálculo por milla.
  assertEquals(resolveFloorBasis(30, 2.00, 400), 'flat');
  // 900 mi en drayage 20': 2.75 × 900 = $2.475 supera los $2.400 del tramo.
  assertEquals(resolveFloorBasis(900, 2.75, 2400), 'rpm');
  // Empate: manda el tramo, que es el criterio conservador.
  assertEquals(resolveFloorBasis(200, 2.00, 400), 'flat');
});

Deno.test('respuesta: en ruta corta NO muestra un rango por milla que contradiga el piso', () => {
  // El caso reportado: 30 mi con piso $400. Antes decía "Mercado $2.00–$2.50/mi"
  // junto a una cifra que equivale a $13.33/mi.
  const build = (locale: Locale) => buildRateCheckMarkdown({
    ...CTX_BASE,
    origen: 'South Palm Beach',
    destino: 'Wellington',
    miles: 30,
    laneLabel: null,
    source: 'llm',
    floor: 400,
    target: 500,
    floorBasis: 'flat',
    bucketRange: '<50 mi',
  }, locale);
  const out = build('es');
  assertEquals(/Mercado: \$/.test(out), false);
  assertStringIncludes(out, 'mínimo del tramo <50 mi');
  assertStringIncludes(out, '$13.33/mi');

  const outEn = build('en');
  assertEquals(/Market: \$/.test(outEn), false);
  assertStringIncludes(outEn, 'segment minimum <50 mi');
  assertStringIncludes(outEn, '$13.33/mi');
});

Deno.test('respuesta: en ruta larga sí muestra el rango de mercado por milla', () => {
  const out = buildRateCheckMarkdown({ ...CTX_BASE, floorBasis: 'rpm' }, 'es');
  assertStringIncludes(out, 'Mercado: $2.00–$2.50/mi');
  assertEquals(/mínimo del tramo/.test(out), false);

  const outEn = buildRateCheckMarkdown({ ...CTX_BASE, floorBasis: 'rpm' }, 'en');
  assertStringIncludes(outEn, 'Market: $2.00–$2.50/mi');
  assertEquals(/segment minimum/.test(outEn), false);
});

Deno.test('respuesta: el mínimo por milla que compara es el que gobierna el piso', () => {
  // Ofrecen $500 en 30 mi = $16.67/mi. Contra el benchmark del equipo ($2.00)
  // parecería una tarifa excelente, pero el piso real es $400 = $13.33/mi.
  const build = (locale: Locale) => buildRateCheckMarkdown({
    ...CTX_BASE,
    miles: 30,
    floor: 400,
    target: 500,
    tarifaOfrecida: 500,
    floorBasis: 'flat',
    bucketRange: '<50 mi',
  }, locale);
  const out = build('es');
  assertStringIncludes(out, '(mín $13.33/mi)');
  assertEquals(/\(mín \$2\.00\/mi\)/.test(out), false);

  const outEn = build('en');
  assertStringIncludes(outEn, '(min $13.33/mi)');
  assertEquals(/\(min \$2\.00\/mi\)/.test(outEn), false);
});

// TEST INVERSION 5/7 (TRUCKY-48 F2-09): antes probaba que un equipo asumido
// aparecía marcado "(asumido dry van)"; ese concepto ya no existe — el equipo
// que llega a buildRateCheckMarkdown siempre es real (resuelto 'ok'), así que
// la respuesta nunca puede contener "asumido".
Deno.test('respuesta: nunca menciona un equipo asumido', () => {
  const out = buildRateCheckMarkdown({ ...CTX_BASE, equipment: equipoOk('reefer') }, 'es');
  assertEquals(/asumido/i.test(out), false);
  assertStringIncludes(out, 'Reefer');

  const outEn = buildRateCheckMarkdown({ ...CTX_BASE, equipment: equipoOk('reefer') }, 'en');
  assertEquals(/assumed/i.test(outEn), false);
  assertStringIncludes(outEn, 'Reefer');
});

Deno.test('respuesta: avisa cuando las millas son estimadas', () => {
  const out = buildRateCheckMarkdown({ ...CTX_BASE, source: 'llm' }, 'es');
  assertStringIncludes(out, 'millas estimadas');

  const outEn = buildRateCheckMarkdown({ ...CTX_BASE, source: 'llm' }, 'en');
  assertStringIncludes(outEn, 'estimated miles');
});

Deno.test('respuesta: declara el recargo de Port Everglades', () => {
  const out = buildRateCheckMarkdown({ ...CTX_BASE, portEverglades: true }, 'es');
  assertStringIncludes(out, 'recargo Port Everglades');

  const outEn = buildRateCheckMarkdown({ ...CTX_BASE, portEverglades: true }, 'en');
  assertStringIncludes(outEn, 'Port Everglades surcharge');
});

Deno.test('respuesta: cuando faltan datos pide aclaración en vez de inventar', () => {
  const out = buildMissingDataMarkdown('es');
  assertStringIncludes(out, 'Necesito más datos');

  const outEn = buildMissingDataMarkdown('en');
  assertStringIncludes(outEn, 'I need more data');
});

Deno.test('respuesta: una respuesta general vacía cae en el mensaje seguro', () => {
  assertEquals(buildGeneralMarkdown('', 'es'), safeFallbackContent('es'));
  assertEquals(buildGeneralMarkdown('   ', 'es'), safeFallbackContent('es'));
  assertEquals(buildGeneralMarkdown(null, 'es'), safeFallbackContent('es'));
  assertEquals(buildGeneralMarkdown('  hola  ', 'es'), 'hola');

  assertEquals(buildGeneralMarkdown('', 'en'), safeFallbackContent('en'));
  assertEquals(buildGeneralMarkdown('   ', 'en'), safeFallbackContent('en'));
  assertEquals(buildGeneralMarkdown(null, 'en'), safeFallbackContent('en'));
  assertEquals(buildGeneralMarkdown('  hello  ', 'en'), 'hello');
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
  const out = buildOffTopicMarkdown('es');
  const lineas = out.split('\n');
  assertEquals(lineas.length, 2);
  assertStringIncludes(out, 'freight');
  assertStringIncludes(out, 'sur de Florida');
  assertEquals(/\$\d/.test(out), false);

  const outEn = buildOffTopicMarkdown('en');
  const lineasEn = outEn.split('\n');
  assertEquals(lineasEn.length, 2);
  assertStringIncludes(outEn, 'freight');
  assertStringIncludes(outEn, 'South Florida');
  assertEquals(/\$\d/.test(outEn), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCKLIST DE DEMO — capa temporal detrás de la allowlist (Fase 2, #7784 item 1).
// Remover después del 2026-08-18; ver comentario TEMPORARY junto a OFF_TOPIC_TOKENS.
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

Deno.test('equipo: resolveEquipment es determinista — 10 llamadas idénticas dan el mismo resultado', () => {
  const resultados = Array.from({ length: 10 }, () => resolveEquipment('reefer'));
  for (const r of resultados) assertEquals(r, resultados[0]);
  const resultadosAsk = Array.from({ length: 10 }, () => resolveEquipment('drayage'));
  for (const r of resultadosAsk) assertEquals(r, resultadosAsk[0]);
});

Deno.test('equipo: buildEquipmentQuestionMarkdown tiene copia distinta para "missing" y "size"', () => {
  const missing = buildEquipmentQuestionMarkdown('missing', 'es');
  const size = buildEquipmentQuestionMarkdown('size', 'es');
  assertStringIncludes(missing, 'qué equipo');
  assertStringIncludes(size, "20' o de 40'");
  assertEquals(missing === size, false);

  const missingEn = buildEquipmentQuestionMarkdown('missing', 'en');
  const sizeEn = buildEquipmentQuestionMarkdown('size', 'en');
  assertStringIncludes(missingEn, 'equipment');
  assertStringIncludes(sizeEn, "20' or 40'");
  assertEquals(missingEn === sizeEn, false);
});
