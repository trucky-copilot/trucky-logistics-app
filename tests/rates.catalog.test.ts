// F6-01 · Fases A/B — la base reproduce exactamente las tablas de hoy.
import { assertEquals, assert } from 'jsr:@std/assert@1';
import {
  seedAll, seedRoutes, planUpsert, verifyAgainstSeed, toRouteRecords, toAliasesFile,
} from '../base44/shared/rateCatalog.ts';
import { loadRoutes, loadAccessorials } from '../base44/functions/marketChat/rateTable.ts';
import aliases from '../base44/shared/rateData/aliases.json' with { type: 'json' };

// Simula cómo devuelve Base44 las filas: con id propio, fechas y llaves en otro orden.
const asDb = (rows: any[]): any[] => rows.map((r, i) => ({
  id: `db${i}`, created_date: '2026-11-11', ...Object.fromEntries(Object.entries(r).reverse()),
}));

Deno.test('semilla: conteos exactos y claves únicas', () => {
  const s = seedAll();
  assertEquals(s.RateRoute.length, 272);
  assertEquals(s.RateAccessorial.length, 28);
  assertEquals(s.RateAlias.filter((a) => a.tipo === 'terminal').length, 9);
  assertEquals(s.RateAlias.filter((a) => a.tipo === 'zip').length, 50);
  for (const [k, f] of [['RateRoute', 'route_id'], ['RateAccessorial', 'accessorial_key'], ['RateAlias', 'alias_key'], ['RateZone', 'zone_key']] as const) {
    const keys = s[k].map((r: any) => r[f]);
    assertEquals(new Set(keys).size, keys.length, `${k} claves únicas`);
  }
});

Deno.test('semilla: el duplicado lake worth beach se conserva (2 filas, mismos valores)', () => {
  const lw = seedRoutes().filter((r) => r.route_id.startsWith('fl-south-palm-beach-lake-worth-beach-grupo-145-'));
  assertEquals(lw.length, 2);
  assertEquals(lw[0].precios, lw[1].precios);
});

Deno.test('verificación: base recién migrada = JSON de hoy (0 diferencias)', () => {
  const s = seedAll();
  const db = { RateRoute: asDb(s.RateRoute), RateAccessorial: asDb(s.RateAccessorial), RateAlias: asDb(s.RateAlias), RateZone: asDb(s.RateZone) };
  const rep = verifyAgainstSeed(db);
  assertEquals(rep.diffs, []);
  assert(rep.ok);
  assertEquals(rep.counts.routes_fl, 209);
  assertEquals(rep.counts.routes_tx, 63);
});

Deno.test('inversa: igual a lo que hoy carga rateTable (rutas y accesoriales)', () => {
  const r = toRouteRecords(asDb(seedRoutes()));
  assertEquals(r.fl, loadRoutes('FL') as any);
  assertEquals(r.tx, loadRoutes('TX') as any);
  const acc = loadAccessorials('FL' as any);
  assert(acc.length > 0);
  assertEquals(toAliasesFile(asDb(seedAll().RateAlias)), aliases as any);
});

Deno.test('verificación: detecta un precio cambiado o una ruta desactivada', () => {
  const s = seedAll();
  const rutas = asDb(s.RateRoute);
  rutas[0] = { ...rutas[0], precios: rutas[0].precios.map((p: any, i: number) => i === 0 ? { ...p, objetivo: p.objetivo + 1 } : p) };
  rutas[5] = { ...rutas[5], activo: false };
  const rep = verifyAgainstSeed({ RateRoute: rutas, RateAccessorial: asDb(s.RateAccessorial), RateAlias: asDb(s.RateAlias), RateZone: asDb(s.RateZone) });
  assert(!rep.ok);
  assert(rep.diffs.some((d) => d.includes('difiere')));
  assert(rep.diffs.some((d) => d.includes('falta')));
});

Deno.test('upsert: 1ª vez crea todo, 2ª vez no hace nada (idempotente)', () => {
  const s = seedAll().RateRoute;
  const p1 = planUpsert('RateRoute', s, []);
  assertEquals(p1.create.length, 272);
  const p2 = planUpsert('RateRoute', s, asDb(s));
  assertEquals([p2.create.length, p2.update.length, p2.unchanged], [0, 0, 272]);
});

Deno.test('upsert: un valor distinto se reporta con sus campos y antes/después', () => {
  const s = seedAll().RateRoute;
  const db = asDb(s);
  db[3] = { ...db[3], millas_ida: 999, actualizado_por: 'x@y.com' }; // auditoría no cuenta
  const p = planUpsert('RateRoute', s, db);
  assertEquals(p.update.length, 1);
  assertEquals(p.update[0].campos, ['millas_ida']);
  assertEquals(p.update[0].antes.millas_ida, 999);
  assertEquals(p.update[0].despues.millas_ida, s[3].millas_ida);
  assertEquals(p.update[0].id, 'db3');
});
