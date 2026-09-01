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

Deno.test('referencias TX: hasta 3, más cercanas a 5 mi para tamaño 40', () => {
  const refs = selectReferenceRoutes('TX', '40', 5);
  assertEquals(refs.length, 3);
  assertEquals(refs[0], { ciudad: 'Houston', millas_ida: 5, objetivo: 950, tamanoMostrado: '40' });
  assertEquals(refs[1], { ciudad: 'Houston', millas_ida: 5, objetivo: 400, tamanoMostrado: '40' });
  assertEquals(refs[2], { ciudad: 'Houston', millas_ida: 5, objetivo: 480, tamanoMostrado: '40' });
});

Deno.test('referencias TX: un tamaño sin fila propia cae al 40 nativo de esa fila, nunca deriva', () => {
  const refs = selectReferenceRoutes('TX', '20', 5);
  assertEquals(refs[0].tamanoMostrado, '40');
  assertEquals(refs[0].objetivo, 950);
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

Deno.test('vecino: Georgia/Carolinas/Alabama resuelven a Florida', () => {
  assertEquals(detectNeighborState('Savannah, Georgia'), 'FL');
  assertEquals(detectNeighborState('Charlotte, North Carolina'), 'FL');
  assertEquals(detectNeighborState('Charleston, South Carolina'), 'FL');
  assertEquals(detectNeighborState('Mobile, Alabama'), 'FL');
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

Deno.test('grupo de vecinos: exactamente los 8 estados del kickoff §7.6', () => {
  assertEquals(Object.keys(NEIGHBOR_STATE_GROUPS).length, 8);
});
