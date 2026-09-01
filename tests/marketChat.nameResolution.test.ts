// ─────────────────────────────────────────────────────────────────────────────
// Pruebas de resolución de nombres — reglas-v3-multiestado Fase 2.
// Cubre base44/functions/marketChat/nameResolution.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { assertEquals } from 'jsr:@std/assert@1';
import {
  resolveFlTerminal,
  resolveTxZip,
  resolveCiudad,
  resolveLocation,
} from '../base44/functions/marketChat/nameResolution.ts';

// ─────────────────────────────────────────────────────────────────────────────
// ALIAS DE TERMINAL DE FLORIDA
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('alias FL: los 9 códigos de terminal del kickoff resuelven a su mercado', () => {
  assertEquals(resolveFlTerminal('POMTOC')?.mercado, 'MIA');
  assertEquals(resolveFlTerminal('SFCT')?.mercado, 'MIA');
  assertEquals(resolveFlTerminal('FIT')?.mercado, 'MIA');
  assertEquals(resolveFlTerminal('PortMiami')?.mercado, 'MIA');
  assertEquals(resolveFlTerminal('MIA')?.mercado, 'MIA');
  assertEquals(resolveFlTerminal('PET')?.mercado, 'PEV');
  assertEquals(resolveFlTerminal('PEV')?.mercado, 'PEV');
  assertEquals(resolveFlTerminal('Everglades')?.mercado, 'PEV');
  assertEquals(resolveFlTerminal('Broward')?.mercado, 'PEV');
});

Deno.test('alias FL: es insensible a mayúsculas y espacios', () => {
  assertEquals(resolveFlTerminal('  pomtoc  ')?.mercado, 'MIA');
  // "Port Miami" con espacio también resuelve: el alias tolera espacios/puntos
  // internos, no solo mayúsculas — mismo principio de tolerancia que la ciudad.
  assertEquals(resolveFlTerminal('Port Miami')?.mercado, 'MIA');
});

Deno.test('alias FL: un código que no está en la tabla no resuelve', () => {
  assertEquals(resolveFlTerminal('JAXPORT'), null);
  assertEquals(resolveFlTerminal(''), null);
  assertEquals(resolveFlTerminal(null), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// ZIP DE TEXAS
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('ZIP TX: un ZIP de Houston resuelve a su ciudad y fila exacta', () => {
  const r = resolveTxZip('77015');
  assertEquals(r?.ciudad, 'Houston');
  assertEquals(r?.routeId, 'tx-local-houston-houston-puerto-18');
});

Deno.test('ZIP TX: un ZIP de Dallas/Ft Worth resuelve a su mercado', () => {
  const r = resolveTxZip('75061');
  assertEquals(r?.ciudad, 'Irving');
  assertEquals(r?.mercado, 'Dallas/Ft Worth (Rail)');
});

Deno.test('ZIP TX: dos ZIP de la misma ciudad resuelven a filas distintas (desambigua Houston)', () => {
  const a = resolveTxZip('77015');
  const b = resolveTxZip('77022');
  assertEquals(a?.ciudad, 'Houston');
  assertEquals(b?.ciudad, 'Houston');
  assertEquals(a?.routeId === b?.routeId, false);
});

Deno.test('ZIP TX: un ZIP fuera de la tabla no resuelve, nunca adivina la más cercana', () => {
  assertEquals(resolveTxZip('90210'), null);
});

Deno.test('ZIP TX: algo que no tiene forma de ZIP no resuelve', () => {
  assertEquals(resolveTxZip('Houston'), null);
  assertEquals(resolveTxZip('7701'), null);
  assertEquals(resolveTxZip(null), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// CIUDAD CON TOLERANCIA A ABREVIATURAS Y ACENTOS
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('ciudad: tolera abreviatura "Ft" por "Fort"', () => {
  assertEquals(resolveCiudad('FL', 'Ft Myers')?.ciudad, 'Fort Myers');
  assertEquals(resolveCiudad('FL', 'Ft. Lauderdale')?.ciudad, 'Fort Lauderdale');
});

Deno.test('ciudad: tolera abreviatura "St"/"St." por "Saint"', () => {
  assertEquals(resolveCiudad('FL', 'St Augustine')?.ciudad, 'St. Augustine');
  assertEquals(resolveCiudad('FL', 'Saint Petersburg')?.ciudad, 'St. Petersburg');
});

Deno.test('ciudad: match exacto sin abreviatura también resuelve', () => {
  assertEquals(resolveCiudad('FL', 'Miami')?.ciudad, 'Miami');
  assertEquals(resolveCiudad('TX', 'Houston')?.ciudad, 'Houston');
  assertEquals(resolveCiudad('TX', 'El Paso')?.ciudad, 'El Paso');
});

Deno.test('ciudad: una ciudad ausente de la tabla no resuelve — nunca adivina la más parecida', () => {
  assertEquals(resolveCiudad('FL', 'Ocala Norte'), null);
  assertEquals(resolveCiudad('FL', 'Ciudad Inventada'), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUCIÓN COMBINADA
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('resolveLocation: precedencia ZIP TX > alias terminal FL > ciudad', () => {
  assertEquals(resolveLocation('77015').status, 'ok');
  const zip = resolveLocation('77015');
  if (zip.status === 'ok') {
    assertEquals(zip.estado, 'TX');
    assertEquals(zip.matchedVia, 'zip');
  }

  const terminal = resolveLocation('POMTOC');
  if (terminal.status === 'ok') {
    assertEquals(terminal.estado, 'FL');
    assertEquals(terminal.mercado, 'MIA');
    assertEquals(terminal.matchedVia, 'alias_terminal');
  } else {
    throw new Error('POMTOC debería resolver');
  }

  const ciudad = resolveLocation('Tampa');
  if (ciudad.status === 'ok') {
    assertEquals(ciudad.estado, 'FL');
    assertEquals(ciudad.matchedVia, 'ciudad');
  } else {
    throw new Error('Tampa debería resolver');
  }
});

Deno.test('resolveLocation: sin ningún match, pide en vez de adivinar', () => {
  assertEquals(resolveLocation('Marte').status, 'ask');
  assertEquals(resolveLocation('').status, 'ask');
  assertEquals(resolveLocation(null).status, 'ask');
});

Deno.test('resolveLocation: es determinista — 10 llamadas idénticas dan el mismo resultado', () => {
  const resultados = Array.from({ length: 10 }, () => resolveLocation('Houston'));
  for (const r of resultados) assertEquals(r, resultados[0]);
});
