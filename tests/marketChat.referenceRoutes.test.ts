import { assertEquals } from 'jsr:@std/assert@1';
import {
  selectReferenceRoutes,
  detectNeighborState,
  resolveReferenceState,
  NEIGHBOR_STATE_GROUPS,
} from '../base44/functions/marketChat/referenceRoutes.ts';

// ─────────────────────────────────────────────────────────────────────────────
// SELECCIÓN — hasta 3, orden por diferencia de millas, desempate por ciudad.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('referencias FL: hasta 3, más cercanas a 20 mi para tamaño 20', () => {
  const refs = selectReferenceRoutes('FL', '20', 20);
  assertEquals(refs.length, 3);
  assertEquals(refs[0], { ciudad: 'Hallandale Beach', millas_ida: 20, objetivo: 390, tamanoMostrado: '20' });
  assertEquals(refs[1], { ciudad: 'Hallandale Beach', millas_ida: 20, objetivo: 410, tamanoMostrado: '20' });
  assertEquals(refs[2], { ciudad: 'Miami Lakes', millas_ida: 21, objetivo: 390, tamanoMostrado: '20' });
});

Deno.test('referencias TX: hasta 3, más cercanas a 5 mi para tamaño 40 (tabla TX v3)', () => {
  const refs = selectReferenceRoutes('TX', '40', 5);
  assertEquals(refs.length, 3);
  assertEquals(refs[0], { ciudad: 'El Paso', millas_ida: 7, objetivo: 300, tamanoMostrado: '40' });
  assertEquals(refs[1], { ciudad: 'Haslet', millas_ida: 3, objetivo: 480, tamanoMostrado: '40' });
  assertEquals(refs[2], { ciudad: 'Grand Prairie', millas_ida: 9, objetivo: 520, tamanoMostrado: '40' });
});

Deno.test('referencias TX: el 20\' sale de su propia columna en TX v3, nunca se deriva', () => {
  const refs = selectReferenceRoutes('TX', '20', 5);
  assertEquals(refs[0].tamanoMostrado, '20');
  assertEquals(refs[0].objetivo, 275);
});

Deno.test('referencias TX: un tamaño sin columna propia (45\') cae al 40 nativo de esa fila, nunca deriva', () => {
  const refs = selectReferenceRoutes('TX', '45', 5);
  assertEquals(refs[0].tamanoMostrado, '40');
  assertEquals(refs[0].objetivo, 300);
});

Deno.test('referencias: excludeCiudad saca la propia ciudad consultada de la lista', () => {
  const conExclusion = selectReferenceRoutes('FL', '20', 20, 'Hallandale Beach');
  assertEquals(conExclusion.some(r => r.ciudad === 'Hallandale Beach'), false);
});

Deno.test('referencias: determinismo — 10 llamadas idénticas dan el mismo resultado (criterio 12)', () => {
  const resultados = Array.from({ length: 10 }, () => selectReferenceRoutes('FL', '40', 300));
  for (const r of resultados) assertEquals(r, resultados[0]);
});

// ─────────────────────────────────────────────────────────────────────────────
// ESTADO VECINO — Decisión 11-A.
// ─────────────────────────────────────────────────────────────────────────────

// Las Carolinas se quitaron a propósito (decisión del dueño, para simplificar el cálculo de millas).
Deno.test('vecino: Georgia/Alabama resuelven a Florida (sin Carolinas)', () => {
  assertEquals(detectNeighborState('Savannah, Georgia'), 'FL');
  assertEquals(detectNeighborState('Mobile, Alabama'), 'FL');
  assertEquals(detectNeighborState('Charlotte, North Carolina'), null);
});

Deno.test('vecino: abreviaturas de 2 letras solo cuentan después de coma', () => {
  assertEquals(detectNeighborState('Shreveport, LA'), 'TX');
  assertEquals(detectNeighborState('Savannah, GA'), 'FL');
  assertEquals(detectNeighborState('pickup in LA'), null, 'LA suelto (Los Ángeles) no es Luisiana');
  assertEquals(detectNeighborState('ok, la carga es para Miami'), null, '"ok, la" no son estados');
  assertEquals(detectNeighborState('Tulsa, OK 74101'), 'TX');
});

Deno.test('vecino: Oklahoma/Nuevo México/Luisiana/Arkansas resuelven a Texas', () => {
  assertEquals(detectNeighborState('Tulsa, Oklahoma'), 'TX');
  assertEquals(detectNeighborState('Santa Fe, New Mexico'), 'TX');
  assertEquals(detectNeighborState('New Orleans, Louisiana'), 'TX');
  assertEquals(detectNeighborState('Little Rock, Arkansas'), 'TX');
});

Deno.test('vecino: un estado lejano no resuelve ningún vecino', () => {
  assertEquals(detectNeighborState('Columbus, Ohio'), null);
  assertEquals(detectNeighborState('Marte'), null);
  assertEquals(detectNeighborState(null), null);
});

Deno.test('resolveReferenceState: vecino cercano se nombra (cercano=true)', () => {
  const r = resolveReferenceState('Savannah, Georgia');
  assertEquals(r, { estado: 'FL', cercano: true });
});

Deno.test('resolveReferenceState: estado lejano o desconocido NO se nombra (cercano=false)', () => {
  assertEquals(resolveReferenceState('Columbus, Ohio').cercano, false);
  assertEquals(resolveReferenceState('ciudad sin estado').cercano, false);
});

Deno.test('grupo de vecinos: 6 estados (sin Carolinas) con sus abreviaturas', () => {
  const porEstado = (e: string) => Object.entries(NEIGHBOR_STATE_GROUPS).filter(([, v]) => v === e).map(([k]) => k).sort();
  assertEquals(porEstado('FL'), ['al', 'alabama', 'ga', 'georgia', 'gorgia']);
  assertEquals(porEstado('TX'), ['ar', 'arkansas', 'la', 'louisiana', 'new mexico', 'nm', 'ok', 'oklahoma']);
});
