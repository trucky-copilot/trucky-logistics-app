// F6-01 · Fase E — reglas de escritura (validación, UPSERT por identidad, eliminar).
import { assertEquals, assert, assertNotEquals } from 'jsr:@std/assert@1';
import { seedAll } from '../base44/shared/rateCatalog.ts';
import { planManual, planExcel, signature, expiredHistory, type Db } from '../base44/shared/rateEdits.ts';
import routesFl from '../base44/functions/marketChat/data/routes.fl.json' with { type: 'json' };
import accFl from '../base44/functions/marketChat/data/accessorials.fl.json' with { type: 'json' };

const asDb = (rows: any[], p: string): any[] => rows.map((r, i) => ({ id: `${p}${i}`, created_date: '2026-11-11T00:00:00Z', ...r }));
function db(): Db {
  const s = seedAll();
  return { RateRoute: asDb(s.RateRoute, 'r'), RateZone: asDb(s.RateZone, 'z'), RateAccessorial: asDb(s.RateAccessorial, 'a'), RateAlias: asDb(s.RateAlias, 'al') };
}
const miami = (d: Db) => d.RateRoute.find((r) => r.route_id === 'fl-local-miami-grupo-100-2')!;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// ── Manual ───────────────────────────────────────────────────────────────────

Deno.test('manual: cambiar el 40\' de Miami → 1 actualización con antes/después', () => {
  const d = db(); const m = miami(d);
  const precios = m.precios.map((p: any) => p.tamano === '40' ? { ...p, objetivo: 450 } : p);
  const p = planManual('RateRoute', [{ key: m.route_id, data: { precios } }], d);
  assertEquals(p.errores, []);
  assertEquals(p.actualizar.length, 1);
  assertEquals(p.actualizar[0].campos, ['precios']);
  assertEquals(p.actualizar[0].id, m.id);
});

Deno.test('manual: sin cambios reales → nada que guardar', () => {
  const d = db(); const m = miami(d);
  const p = planManual('RateRoute', [{ key: m.route_id, data: { precios: m.precios, millas_ida: m.millas_ida } }], d);
  assertEquals([p.actualizar.length, p.iguales], [0, 1]);
});

Deno.test('manual: valida precios, piso, millas y zona', () => {
  const d = db(); const m = miami(d);
  const casos: [any, string][] = [
    [{ precios: [{ tamano: '40', objetivo: -1 }] }, 'precio 40 inválido'],
    [{ precios: [{ tamano: '40', objetivo: 400, piso_tabla: 500 }] }, 'piso 40 mayor que el objetivo'],
    [{ precios: [] }, 'debe tener al menos un precio'],
    [{ millas_ida: -3 }, 'millas de ida inválidas (0 a 3000)'],
    [{ zona: 'NO-EXISTE' }, 'la zona "NO-EXISTE" no existe o está inactiva en FL'],
  ];
  for (const [data, msg] of casos) {
    const p = planManual('RateRoute', [{ key: m.route_id, data }], d);
    assert(p.errores.some((e) => e.mensaje === msg), `${msg} → ${JSON.stringify(p.errores)}`);
  }
});

Deno.test('manual: ruta nueva recibe clave, origen "manual" y semántica de millas del estado', () => {
  const d = db();
  const p = planManual('RateRoute', [{ key: null, data: { estado: 'TX', ciudad: 'Testville', mercado: 'Houston (Puerto)', zona: d.RateRoute.find((r) => r.estado === 'TX')!.zona, millas_ida: 30, precios: [{ tamano: '40', objetivo: 600, piso_tabla: 540 }] } }], d);
  assertEquals(p.errores, []);
  const n = p.crear[0].despues!;
  assert(n.route_id.startsWith('tx-'));
  assertEquals(n.fuente.archivo, 'manual');
  assertEquals(n.semantica_millas.precio_incluye_regreso, false);
});

Deno.test('manual: no deja crear una ruta repetida (misma ciudad/mercado/zona)', () => {
  const d = db(); const m = miami(d);
  const p = planManual('RateRoute', [{ key: null, data: { estado: 'FL', ciudad: 'miami', mercado: 'MIA', zona: m.zona, millas_ida: 4, precios: [{ tamano: '40', objetivo: 429 }] } }], d);
  assert(p.errores.some((e) => e.mensaje.startsWith('ya existe otra ruta')));
});

Deno.test('manual: eliminar ruta TX avisa de los ZIP que apuntan a ella', () => {
  const d = db();
  const zip = d.RateAlias.find((a) => a.tipo === 'zip' && d.RateRoute.some((r) => r.route_id === a.valor))!;
  const r = d.RateRoute.find((x) => x.route_id === zip.valor)!;
  const p = planManual('RateRoute', [{ key: r.route_id, eliminar: true }], d);
  assertEquals(p.eliminar.length, 1);
  assert(p.avisos[0].includes(zip.clave));
});

Deno.test('manual: no elimina una zona con rutas ni la desactiva con rutas activas', () => {
  const d = db(); const z = d.RateZone.find((x) => x.zona === 'LOCAL' && x.estado === 'FL')!;
  assert(planManual('RateZone', [{ key: z.zone_key, eliminar: true }], d).errores[0].mensaje.includes('rutas'));
  assert(planManual('RateZone', [{ key: z.zone_key, data: { activo: false } }], d).errores[0].mensaje.includes('rutas activas'));
  assertEquals(planManual('RateZone', [{ key: z.zone_key, data: { descripcion: 'Miami-Dade' } }], d).actualizar[0].campos, ['descripcion']);
});

Deno.test('manual: alias ZIP exige 5 dígitos y una ruta TX existente', () => {
  const d = db(); const tx = d.RateRoute.find((r) => r.estado === 'TX')!;
  assert(planManual('RateAlias', [{ key: null, data: { estado: 'TX', tipo: 'zip', clave: '123', valor: tx.route_id } }], d).errores.length > 0);
  assert(planManual('RateAlias', [{ key: null, data: { estado: 'TX', tipo: 'zip', clave: '77777', valor: 'tx-nada' } }], d).errores.length > 0);
  const ok = planManual('RateAlias', [{ key: null, data: { estado: 'TX', tipo: 'zip', clave: '77777', valor: tx.route_id } }], d);
  assertEquals([ok.errores.length, ok.crear[0].key], [0, 'tx-zip-77777']);
  const fix = d.RateAlias.find((a) => a.alias_key === 'tx-zip-75006')!;
  assertEquals(planManual('RateAlias', [{ key: fix.alias_key, data: { valor: tx.route_id } }], d).actualizar.length, 1);
});

Deno.test('manual: el registro de documentación interna no se elimina', () => {
  const d = db();
  assert(planManual('RateAlias', [{ key: 'documentacion', eliminar: true }], d).errores.length === 1);
});

// ── Excel ────────────────────────────────────────────────────────────────────

// Simula una versión nueva del Excel: misma data pero con una fila insertada
// arriba (todas las filas e ids se corren +1), que es lo que antes duplicaba.
function excelCorrido() {
  const routes = clone(routesFl as any[]).map((r) => ({ ...r, id: r.id.replace(/-(\d+)$/, (_: string, n: string) => `-${+n + 1}`), fuente: { ...r.fuente, fila: r.fuente.fila + 1, sha: 'nuevo' } }));
  return { routes, accessorials: clone(accFl as any[]) };
}

Deno.test('excel: mismas tarifas con filas corridas → 0 nuevas, 0 cambios, claves conservadas', () => {
  const d = db();
  const p = planExcel('FL', excelCorrido(), d, true);
  assertEquals(p.errores, []);
  assertEquals([p.crear.length, p.actualizar.length, p.eliminar.length], [0, 0, 0]);
  assertEquals(p.iguales, 209 + 20);
  assertEquals(p.metadatos.length, 209); // solo se actualiza el origen (fila/sha), sin historial
});

Deno.test('excel: el duplicado lake worth beach empareja sus 2 filas (no crea ni elimina)', () => {
  const d = db();
  const p = planExcel('FL', excelCorrido(), d, true);
  const lw = p.metadatos.filter((m) => m.key.includes('lake-worth-beach-grupo-145'));
  assertEquals(lw.length, 2);
  assertNotEquals(lw[0].id, lw[1].id);
});

Deno.test('excel: precio cambiado, ruta nueva, zona nueva y ruta que ya no viene', () => {
  const d = db();
  const inc = excelCorrido();
  inc.routes[0].precios[1].objetivo = 999;                       // cambio
  const quitada = inc.routes.pop();                               // ya no viene
  inc.routes.push({ ...clone(inc.routes[0]), id: 'fl-otr-500-ocala-x', ciudad: 'Ocala', zona: 'OTR-500', millas_ida: 300 }); // nueva + zona nueva
  const p = planExcel('FL', inc, d, true);
  assertEquals(p.errores, []);
  assertEquals(p.actualizar.map((u) => u.key), ['fl-local-miami-grupo-100-2']);
  assertEquals(p.crear.map((c) => c.entidad).sort(), ['RateRoute', 'RateZone']);
  assertEquals(p.eliminar.map((e) => e.key), [d.RateRoute.find((r) => r.route_id === quitada.id.replace(/-(\d+)$/, (_: string, n: string) => `-${+n - 1}`))!.route_id]);
  const sin = planExcel('FL', inc, d, false);
  assertEquals(sin.eliminar.length, 0);
  assert(sin.avisos[0].includes('no vienen en el archivo'));
});

Deno.test('excel: un precio inválido bloquea todo el archivo', () => {
  const inc = excelCorrido(); inc.routes[5].precios[0].objetivo = 0;
  const p = planExcel('FL', inc, db(), true);
  assert(p.errores.length > 0);
});

Deno.test('excel: archivo de TX cargado como FL → error', () => {
  const inc = excelCorrido(); inc.routes = inc.routes.map((r) => ({ ...r, estado: 'TX' }));
  assert(planExcel('FL', inc, db(), false).errores.length > 0);
});

// ── Firma e historial ────────────────────────────────────────────────────────

Deno.test('firma: cambia si alguien modificó un registro después de la vista previa', () => {
  const d = db(); const a = signature(d.RateRoute);
  d.RateRoute[3] = { ...d.RateRoute[3], updated_date: '2026-11-12T00:00:00Z' };
  assertNotEquals(signature(d.RateRoute), a);
});

Deno.test('historial: se limpia lo de más de 12 meses', () => {
  const now = Date.parse('2026-11-11T00:00:00Z');
  const rows = [{ id: 'a', created_date: '2025-10-01T00:00:00Z' }, { id: 'b', created_date: '2026-01-01T00:00:00Z' }, { id: 'c' }];
  assertEquals(expiredHistory(rows, now).map((r) => r.id), ['a']);
});
