// ─────────────────────────────────────────────────────────────────────────────
// Pruebas de rateTable.ts (reglas-v3-multiestado, Fase 1 — conversión y carga).
//
// rateTable.ts carga los JSON versionados generados OFFLINE por
// scripts/convertRateTables.ts (ese script NO corre en runtime — ver grep de
// integridad más abajo). Estas pruebas cubren:
//   - conteo exacto: 209 FL + 50 TX = 259 rutas (criterio de éxito 1)
//   - OO y Margen jamás se cargan (criterio de éxito 15)
//   - Waiting Time se carga tal cual viene en v6 ($75/hora, sin override)
//   - el reporte de rutas no encontradas registra query/estado/timestamp
// ─────────────────────────────────────────────────────────────────────────────

import { assertEquals, assert, assertExists } from 'jsr:@std/assert@1';
import {
  loadRoutes,
  loadAccessorials,
  getRouteCounts,
  lookupRoute,
  recordUnmatchedRoute,
  getUnmatchedRoutes,
  clearUnmatchedRoutes,
} from '../base44/functions/marketChat/rateTable.ts';

Deno.test('rateTable: carga exactamente 209 rutas FL (v9) + 63 TX (v3) = 272', () => {
  const counts = getRouteCounts();
  assertEquals(counts.fl, 209, 'FL debe tener exactamente 209 rutas');
  assertEquals(counts.tx, 63, 'TX v3 debe tener exactamente 63 rutas');
  assertEquals(counts.total, 272, 'el total debe ser 209 + 63 = 272');
});

Deno.test('rateTable: cada ruta FL trae grupo de tarifa (26 grupos en total)', () => {
  const rutasFl = loadRoutes('FL');
  assertEquals(rutasFl.length, 209);
  const grupos = new Set(rutasFl.map(r => r.grupo));
  assertEquals(grupos.size, 26, 'debe haber exactamente 26 grupos de tarifa distintos en FL');
  for (const r of rutasFl) {
    assertExists(r.grupo, `la ruta ${r.ciudad} debe traer grupo de tarifa`);
  }
});

Deno.test('rateTable: cada ruta declara su semántica de millas explícitamente', () => {
  const todas = [...loadRoutes('FL'), ...loadRoutes('TX')];
  for (const r of todas) {
    assertExists(r.semantica_millas, `${r.estado} ${r.ciudad} debe traer semantica_millas`);
    assert(['ida', 'ida_y_vuelta'].includes(r.semantica_millas.tipo_millas));
    assertEquals(typeof r.semantica_millas.precio_incluye_regreso, 'boolean');
    assert(r.semantica_millas.nota.length > 0, 'la nota de semántica no debe estar vacía');
  }
});

Deno.test('rateTable: FL declara millas de ida con precio que ya incluye el regreso', () => {
  const rutasFl = loadRoutes('FL');
  for (const r of rutasFl) {
    assertEquals(r.semantica_millas.tipo_millas, 'ida');
    assertEquals(r.semantica_millas.precio_incluye_regreso, true);
  }
});

Deno.test('rateTable: TX declara millas de ida (columna "Millas (ida)" de la hoja)', () => {
  const rutasTx = loadRoutes('TX');
  for (const r of rutasTx) {
    assertEquals(r.semantica_millas.tipo_millas, 'ida');
  }
});

Deno.test('rateTable: TX trae piso Y objetivo de tabla; FL trae solo objetivo (sin piso de tabla)', () => {
  const rutasTx = loadRoutes('TX');
  for (const r of rutasTx) {
    for (const p of r.precios) {
      assertExists(p.piso_tabla, `TX ${r.ciudad} debe traer piso de tabla`);
      assert(p.piso_tabla! > 0);
    }
  }
  const rutasFl = loadRoutes('FL');
  for (const r of rutasFl) {
    for (const p of r.precios) {
      assertEquals(p.piso_tabla, null, `FL ${r.ciudad} NO debe traer piso de tabla`);
    }
  }
});

Deno.test('rateTable: OO y Margen jamás se cargan en ningún campo', () => {
  const todas = [...loadRoutes('FL'), ...loadRoutes('TX')];
  const serializado = JSON.stringify(todas).toLowerCase();
  assert(!serializado.includes('"oo"'), 'no debe existir ningún campo "oo"');
  assert(!serializado.includes('margen'), 'no debe existir ningún campo/valor "margen"');
  // Verificación estructural: los únicos campos de precio permitidos son estos.
  for (const r of todas) {
    for (const p of r.precios) {
      const claves = Object.keys(p).sort();
      assertEquals(claves, ['derivado', 'objetivo', 'piso_tabla', 'tamano'].sort());
    }
  }
});

// En v9 "Waiting Time" se presenta como "Detention" (loadAccessorials lo renombra).
Deno.test('rateTable: Detention (antes Waiting Time) se carga a $75/hora, sin override', () => {
  const accesorialesFl = loadAccessorials('FL');
  const detention = accesorialesFl.find(a => a.concepto.toLowerCase().includes('detention'));
  assertExists(detention, 'debe existir el accesorial Detention en FL');
  assert(detention!.monto.includes('75'), `Detention debe ser $75/hora, vino: "${detention!.monto}"`);
});

Deno.test('rateTable: accesoriales de ambos estados se cargan (FL 20 conceptos v9, TX 8 conceptos v3)', () => {
  const fl = loadAccessorials('FL');
  const tx = loadAccessorials('TX');
  assertEquals(fl.length, 20, 'FL debe traer los 20 cargos accesoriales de la hoja v9');
  // NOTA: el kickoff dice "9 conceptos" para TX, pero la hoja Accesoriales_TX
  // solo tiene 7 filas de datos (fila 1=título, fila 2=encabezado, filas 3-9=
  // 7 conceptos). Se carga lo que realmente hay en el archivo, no lo que dice
  // el kickoff — ver apply-progress lote 1 para el detalle de la discrepancia.
  assertEquals(tx.length, 8, 'TX v3 trae 8 conceptos en Accesoriales_TX');
});

Deno.test('rateTable: lookupRoute encuentra una ruta FL conocida (Pompano) por ciudad y tamaño', () => {
  const match = lookupRoute('FL', 'Pompano Beach', '20');
  assertExists(match, 'Pompano Beach debe existir en la tabla FL');
});

Deno.test('rateTable: lookupRoute encuentra una ruta TX conocida (Houston) por ciudad y tamaño 40', () => {
  const rutasTx = loadRoutes('TX');
  const houston = rutasTx.find(r => r.ciudad.toLowerCase() === 'houston');
  assertExists(houston, 'debe existir al menos una fila de Houston en TX');
  const match = lookupRoute('TX', houston!.ciudad, '40');
  assertExists(match);
});

Deno.test('rateTable: lookupRoute devuelve null para una ruta que no está en la tabla', () => {
  const match = lookupRoute('FL', 'Ciudad Que No Existe En Ninguna Tabla', '20');
  assertEquals(match, null);
});

Deno.test('rateTable: una ruta ausente se registra en el reporte de rutas no encontradas', () => {
  clearUnmatchedRoutes();
  const antes = getUnmatchedRoutes().length;
  recordUnmatchedRoute('Ocala', 'FL');
  const despues = getUnmatchedRoutes();
  assertEquals(despues.length, antes + 1);
  const ultimo = despues[despues.length - 1];
  assertEquals(ultimo.ciudad, 'Ocala');
  assertEquals(ultimo.estado, 'FL');
  assertExists(ultimo.timestamp, 'debe registrar timestamp');
});

Deno.test('rateTable: registrar una ruta no encontrada nunca lanza ni bloquea', () => {
  clearUnmatchedRoutes();
  // No debe lanzar con entradas raras/vacías.
  recordUnmatchedRoute('', 'FL');
  recordUnmatchedRoute(null as unknown as string, 'TX');
  assert(true, 'no debe llegar a lanzar antes de esta línea');
});

// El log en consola se quitó a propósito (se confundía con un error); el registro
// queda disponible en getUnmatchedRoutes().
Deno.test('rateTable: registrar una ruta no encontrada la deja en el reporte, sin ensuciar la consola', () => {
  clearUnmatchedRoutes();
  const llamadas: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { llamadas.push(args.map(String).join(' ')); };
  try {
    recordUnmatchedRoute('Ocala', 'FL');
  } finally {
    console.error = originalError;
  }
  assertEquals(llamadas.length, 0, 'ya no se loguea en consola');
  const reporte = getUnmatchedRoutes();
  assertEquals(reporte.length, 1);
  assertEquals(reporte[0].ciudad, 'Ocala');
  assertEquals(reporte[0].estado, 'FL');
});

Deno.test('rateTable: el log de ruta no encontrada no lanza aunque console.error falle', () => {
  clearUnmatchedRoutes();
  const originalError = console.error;
  console.error = () => { throw new Error('logging roto'); };
  try {
    recordUnmatchedRoute('Ocala', 'FL');
    assert(true, 'no debe propagar el error del logger');
  } finally {
    console.error = originalError;
  }
});
