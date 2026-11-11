// F6-01 · Fase F — prueba de aceptación de punta a punta con una base en memoria:
// base vacía → migración → chat igual → edición manual → Excel → eliminar → historial.
import { assertEquals, assert, assertNotEquals } from 'jsr:@std/assert@1';
import { seedAll, verifyAgainstSeed } from '../base44/shared/rateCatalog.ts';
import { planManual, planExcel } from '../base44/shared/rateEdits.ts';
import { readDb, firmaDe, execute, purgeHistory, ENTITIES } from '../base44/shared/rateApply.ts';
import { ensureRatesFromDb, resetRateSourceCache } from '../base44/functions/marketChat/rateSource.ts';
import { resetRateTablesToBundled, getRateSource, loadRoutes } from '../base44/functions/marketChat/rateTable.ts';
import { resetAliasesToBundled, resolveCiudad } from '../base44/functions/marketChat/nameResolution.ts';
import { resolveDrayageQuote } from '../base44/functions/marketChat/rateEngine.ts';
import routesFl from '../base44/functions/marketChat/data/routes.fl.json' with { type: 'json' };
import accFl from '../base44/functions/marketChat/data/accessorials.fl.json' with { type: 'json' };

// Base en memoria con la misma interfaz que base44.asServiceRole.entities.
function memoryDb() {
  let seq = 0; let clock = Date.parse('2026-11-11T12:00:00Z');
  const tick = () => new Date(clock += 1000).toISOString();
  const tables: Record<string, any[]> = {};
  const ent = (name: string) => {
    tables[name] = tables[name] || [];
    return {
      filter: async (_q: unknown, sort?: string, limit = 50, skip = 0) => {
        const desc = sort?.startsWith('-'); const f = sort?.replace(/^-/, '');
        const rows = [...tables[name]].sort((a, b) => !f ? 0 : (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * (desc ? -1 : 1));
        return rows.slice(skip, skip + limit).map((r) => structuredClone(r));
      },
      bulkCreate: async (rows: any[]) => { for (const r of rows) { const now = tick(); tables[name].push({ ...structuredClone(r), id: `id${++seq}`, created_date: r.created_date ?? now, updated_date: now }); } },
      update: async (id: string, data: any) => { const r = tables[name].find((x) => x.id === id); if (!r) throw new Error('404'); Object.assign(r, structuredClone(data), { updated_date: tick() }); },
      delete: async (id: string) => { tables[name] = tables[name].filter((x) => x.id !== id); },
    };
  };
  const entities: any = {};
  for (const n of [...ENTITIES, 'RateChangeLog']) entities[n] = ent(n);
  return { entities, tables, base44: { asServiceRole: { entities } } };
}

const quote40 = (ciudad: string) => (resolveDrayageQuote({ destinoRaw: `${ciudad}, FL`, tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null }) as any);
async function chat(base44: any) { resetRateSourceCache(); return await ensureRatesFromDb(base44); }
function resetAll() { resetRateTablesToBundled(); resetAliasesToBundled(); resetRateSourceCache(); }
const EMAIL = 'luis.bermudez@ogm.com.co';

Deno.test('aceptación F6-01: ciclo completo de tarifas en base de datos', async () => {
  resetAll();
  const m = memoryDb();

  // 1. Base vacía → el chat sigue con los archivos (nada cambia al publicar).
  assertEquals((await chat(m.base44)).source, 'json');
  const original = JSON.stringify(quote40('Miami'));
  assertEquals(quote40('Miami').calculo.objetivo, 429);

  // 2. Migración (lo que hace adminMigrateRates "apply" sobre base vacía).
  const seed = seedAll();
  for (const e of ENTITIES) await m.entities[e].bulkCreate(seed[e]);
  const ver = verifyAgainstSeed(await readDb(m.entities));
  assertEquals([ver.ok, ver.diffs, ver.checks], [true, [], ver.checks]);

  // 3. El chat ya lee de la base y responde idéntico.
  assertEquals((await chat(m.base44)).source, 'db');
  assertEquals(getRateSource(), 'db');
  assertEquals(JSON.stringify(quote40('Miami')), original);

  // 4. Edición manual del 40' de Miami → historial → el chat la usa.
  let db = await readDb(m.entities);
  const miami = db.RateRoute.find((r) => r.route_id === 'fl-local-miami-grupo-100-2')!;
  const firma1 = firmaDe(db);
  const p1 = planManual('RateRoute', [{ key: miami.route_id, data: { precios: miami.precios.map((p: any) => p.tamano === '40' ? { ...p, objetivo: 450 } : p) } }], db);
  assertEquals(p1.errores, []);
  await execute(m.entities, p1, EMAIL, 'manual');
  db = await readDb(m.entities);
  assertNotEquals(firmaDe(db), firma1, 'la firma cambia: otra vista previa vieja ya no se puede aplicar');
  await chat(m.base44);
  assertEquals(quote40('Miami').calculo.objetivo, 450);
  assertEquals(m.tables.RateChangeLog.length, 1);
  assertEquals(m.tables.RateChangeLog[0].usuario_email, EMAIL);
  assertEquals(m.tables.RateChangeLog[0].campos, ['precios']);

  // 5. Excel nuevo (filas corridas) con las tarifas originales → solo vuelve Miami a 429.
  const excel = {
    routes: structuredClone(routesFl as any[]).map((r) => ({ ...r, id: r.id + '-v10', fuente: { ...r.fuente, fila: r.fuente.fila + 1, sha: 'v10' } })),
    accessorials: structuredClone(accFl as any[]),
  };
  const antes = m.tables.RateRoute.length;
  const p2 = planExcel('FL', excel, db, true);
  assertEquals([p2.crear.length, p2.actualizar.length, p2.eliminar.length], [0, 1, 0]);
  await execute(m.entities, p2, EMAIL, 'excel');
  assertEquals(m.tables.RateRoute.length, antes, 'no se acumulan filas');
  await chat(m.base44);
  assertEquals(quote40('Miami').calculo.objetivo, 429);
  assertEquals(m.tables.RateChangeLog.length, 2, 'los cambios solo de fila de origen no llenan el historial');
  assertEquals(m.tables.RateRoute.find((r) => r.route_id === miami.route_id)!.fuente.sha, 'v10');

  // 6. Eliminar una ruta: desaparece del chat y de la base; el historial guarda su copia.
  db = await readDb(m.entities);
  const doral = db.RateRoute.find((r) => r.estado === 'FL' && r.ciudad === 'Doral')!;
  const p3 = planManual('RateRoute', [{ key: doral.route_id, eliminar: true }], db);
  await execute(m.entities, p3, EMAIL, 'manual');
  assertEquals(m.tables.RateRoute.length, antes - 1);
  await chat(m.base44);
  assert(!loadRoutes('FL').some((r) => r.id === doral.route_id));
  const log = m.tables.RateChangeLog.at(-1)!;
  assertEquals([log.accion, log.antes.ciudad, log.antes.precios.length], ['eliminar', 'Doral', 4]);
  assertEquals(resolveCiudad('FL', 'Miami')?.ciudad, 'Miami');

  // 7. Historial de más de 12 meses se limpia; lo reciente se queda.
  await m.entities.RateChangeLog.bulkCreate([{ entidad: 'RateRoute', registro_key: 'viejo', accion: 'actualizar', created_date: '2025-01-01T00:00:00Z' }]);
  assertEquals(await purgeHistory(m.entities), 1);
  assertEquals(m.tables.RateChangeLog.length, 3);
  resetAll();
});

Deno.test('aceptación F6-01: migración a medias → el chat no mezcla, sigue con los archivos', async () => {
  resetAll();
  const m = memoryDb();
  const seed = seedAll();
  await m.entities.RateZone.bulkCreate(seed.RateZone);
  await m.entities.RateRoute.bulkCreate(seed.RateRoute.slice(0, 100)); // se cortó a mitad
  const r = await chat(m.base44);
  assertEquals([r.source, r.reason], ['json', 'migracion-incompleta']);
  assertEquals(loadRoutes('FL').length, 209);
  resetAll();
});
