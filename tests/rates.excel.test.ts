// F6-01 · Fase E — Excel de punta a punta: se arma un .xlsx con el formato de
// las hojas originales a partir de las tarifas actuales, se lee con el MISMO
// conversor que usa adminSaveRates y se compara con la base: 0 cambios.
import { assertEquals, assert } from 'jsr:@std/assert@1';
import XLSX from 'npm:xlsx@0.18.5';
import { seedAll } from '../base44/shared/rateCatalog.ts';
import { planExcel, type Db } from '../base44/shared/rateEdits.ts';
import { convertFlorida, convertTexas } from '../base44/shared/rateExcel.ts';
import routesFl from '../base44/shared/rateData/routes.fl.json' with { type: 'json' };
import routesTx from '../base44/shared/rateData/routes.tx.json' with { type: 'json' };
import accFl from '../base44/shared/rateData/accessorials.fl.json' with { type: 'json' };
import accTx from '../base44/shared/rateData/accessorials.tx.json' with { type: 'json' };

const asDb = (rows: any[], p: string): any[] => rows.map((r, i) => ({ id: `${p}${i}`, ...r }));
function db(): Db {
  const s = seedAll();
  return { RateRoute: asDb(s.RateRoute, 'r'), RateZone: asDb(s.RateZone, 'z'), RateAccessorial: asDb(s.RateAccessorial, 'a'), RateAlias: asDb(s.RateAlias, 'al') };
}
const price = (r: any, t: string, k = 'objetivo') => r.precios.find((p: any) => p.tamano === t)?.[k] ?? null;

// Arma un .xlsx real, lo vuelve a leer y lo convierte en filas por hoja con las
// MISMAS opciones que usa el navegador (src/pages/admin/rates/OtherTabs.jsx).
function roundTrip(sheets: Record<string, unknown[][]>) {
  const wb = XLSX.utils.book_new();
  for (const [n, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n);
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const read = XLSX.read(new Uint8Array(bytes), { type: 'array' });
  const out: Record<string, unknown[][]> = {};
  for (const n of read.SheetNames) out[n] = XLSX.utils.sheet_to_json(read.Sheets[n], { header: 1, defval: null }) as unknown[][];
  return out;
}

// La tabla oficial actual trae Lake Worth Beach repetida (filas 81 y 82): con la
// validación estricta hay que quitar una antes de cargar el Excel.
function flWorkbook(extraTopRow = false, conDuplicado = false) {
  const head: unknown[][] = [['Tarifas FL'], ['Zona', 'Puerto', 'Ciudad', 'Millas', 'Grupo', "20'", "40'", "45'", "20' Heavy"]];
  if (extraTopRow) head.push(['', '', '', null]); // fila vacía insertada: todas las filas se corren
  const rows = (routesFl as any[]).filter((r) => conDuplicado || r.id !== 'fl-south-palm-beach-lake-worth-beach-grupo-145-81').map((r) => [r.zona, r.mercado, r.ciudad, r.millas_ida, r.grupo, price(r, '20'), price(r, '40'), price(r, '45'), price(r, '20_heavy')]);
  const acc = (accFl as any[]).map((a) => [a.concepto, a.gatillo, a.monto, a.nota]);
  return roundTrip({ Rates_Drayage: [...head, ...rows], Accesoriales: [['Accesoriales'], ['Concepto', 'Gatillo', 'Monto', 'Nota'], ...acc] });
}

Deno.test('excel FL real: mismo contenido → 0 nuevas, 0 cambios, 0 eliminadas', () => {
  const inc = convertFlorida(flWorkbook(), 'Trucky_Rates_Drayage_FL_v10.xlsx', 'sha-nuevo');
  assertEquals(inc.routes.length, 208);
  const p = planExcel('FL', inc as any, db(), false);
  assertEquals(p.errores, []);
  assertEquals([p.crear.length, p.actualizar.length, p.eliminar.length], [0, 0, 0]);
});

Deno.test('excel FL real con la fila repetida de Lake Worth Beach → bloqueado', () => {
  const inc = convertFlorida(flWorkbook(false, true), 'v10.xlsx', 's');
  const p = planExcel('FL', inc as any, db(), false);
  assert(p.errores.some((e) => e.mensaje.startsWith('Ruta repetida: Lake Worth Beach')));
});

Deno.test('excel FL real: con una fila insertada arriba tampoco duplica', () => {
  const inc = convertFlorida(flWorkbook(true), 'v11.xlsx', 'sha-2');
  const p = planExcel('FL', inc as any, db(), false);
  assertEquals([p.crear.length, p.actualizar.length, p.eliminar.length], [0, 0, 0]);
  assert(p.metadatos.length > 0); // solo cambia la fila de origen
});

Deno.test('excel TX real: mismo contenido → 0 nuevas, 0 cambios, 0 eliminadas', () => {
  const rows = (routesTx as any[]).map((r) => [r.mercado, r.zona, r.ciudad, r.millas_ida, price(r, '20', 'piso_tabla'), price(r, '20'), price(r, '40', 'piso_tabla'), price(r, '40'), null, r.fuente.nota_original ?? null]);
  const acc = (accTx as any[]).map((a) => [a.concepto, a.monto, a.nota]);
  const wb = roundTrip({ Rates_Drayage_TX: [['Tarifas TX'], ['Mercado', 'Zona', 'Ciudad', 'Millas'], ...rows], Accesoriales_TX: [['Acc'], ['Concepto', 'Monto', 'Nota'], ...acc] });
  const inc = convertTexas(wb, 'Trucky_Rates_Drayage_TX_v4.xlsx', 'sha-tx');
  assertEquals(inc.routes.length, 63);
  const p = planExcel('TX', inc as any, db(), true);
  assertEquals(p.errores, []);
  assertEquals([p.crear.length, p.actualizar.length, p.eliminar.length], [0, 0, 0]);
});

Deno.test('excel: hoja equivocada → error claro del conversor', () => {
  const wb = roundTrip({ Otra: [['x']] });
  let msg = '';
  try { convertFlorida(wb, 'x.xlsx', 's'); } catch (e) { msg = (e as Error).message; }
  assert(msg.includes('No existe la hoja "Rates_Drayage"'));
});
