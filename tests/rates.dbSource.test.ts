// F6-01 · Fase C — el chat lee las tarifas de la base y responde IGUAL que hoy.
//
// Regresión: se corren las mismas consultas con la fuente JSON (hoy) y con la
// fuente base (filas simuladas como las devuelve Base44). Deben ser idénticas.
import { assertEquals, assert, assertNotEquals } from 'jsr:@std/assert@1';
import { seedAll } from '../base44/shared/rateCatalog.ts';
import { resolveDrayageQuote, resolveAccessorialsForState } from '../base44/functions/marketChat/rateEngine.ts';
import { resolveTxZip, resolveFlTerminal, resolveCiudad } from '../base44/functions/marketChat/nameResolution.ts';
import { getRateSource, getRouteCounts, resetRateTablesToBundled, loadRoutes } from '../base44/functions/marketChat/rateTable.ts';
import { resetAliasesToBundled } from '../base44/functions/marketChat/nameResolution.ts';
import { buildFromRows, ensureRatesFromDb, resetRateSourceCache, RATE_CACHE_TTL_MS } from '../base44/functions/marketChat/rateSource.ts';

const asDb = (rows: any[]): any[] => rows.map((r, i) => ({
  id: `db${i}`, created_date: '2026-11-11', ...Object.fromEntries(Object.entries(r).reverse()),
}));
const seed = seedAll();
const dbRows = () => ({ routes: asDb(seed.RateRoute), accessorials: asDb(seed.RateAccessorial), aliases: asDb(seed.RateAlias) });

function fakeBase44(rows: { routes: any[]; accessorials: any[]; aliases: any[] } | 'error') {
  const ent = (list: () => any[]) => ({
    filter: async (_q: unknown, _s: unknown, limit: number, skip: number) => {
      if (rows === 'error') throw new Error('db caída');
      return list().slice(skip, skip + limit);
    },
  });
  const r = rows === 'error' ? { routes: [], accessorials: [], aliases: [] } : rows;
  return { asServiceRole: { entities: { RateRoute: ent(() => r.routes), RateAccessorial: ent(() => r.accessorials), RateAlias: ent(() => r.aliases) } } };
}

function resetAll() { resetRateTablesToBundled(); resetAliasesToBundled(); resetRateSourceCache(); }

// ~70 consultas: ciudades FL y TX (de la propia tabla), todos los tamaños, con
// y sin millas de Google, fuera de tabla, tarifa ofrecida, RPM del camión,
// accesoriales, ZIP de TX y terminales FL.
function queries() {
  const fl = loadRoutes('FL'); const tx = loadRoutes('TX');
  const pick = (l: any[], n: number) => Array.from({ length: n }, (_, i) => l[Math.floor(i * l.length / n)]);
  const q: any[] = [];
  const tam = ['20', '40', '45', '20_heavy'] as const;
  pick(fl, 20).forEach((r, i) => q.push({ destinoRaw: `${r.ciudad}, FL`, tamano: tam[i % 4], millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: i % 3 === 0 ? 650 : null }));
  pick(tx, 15).forEach((r, i) => q.push({ destinoRaw: `${r.ciudad}, TX`, tamano: tam[i % 4], millasIdaDeclaradas: null, pagoCamionRpm: i % 2 ? 2.1 : null, tarifaOfrecida: null }));
  pick(fl, 6).forEach((r) => q.push({ destinoRaw: `${r.ciudad}, FL`, tamano: '40', millasIdaDeclaradas: r.millas_ida + 25, pagoCamionRpm: null, tarifaOfrecida: null }));
  for (const m of [15, 60, 140, 260]) q.push({ destinoRaw: 'Fake City, Florida', tamano: '40', millasIdaDeclaradas: m, pagoCamionRpm: null, tarifaOfrecida: null });
  for (const m of [30, 120, 300]) q.push({ destinoRaw: 'Fake Town, Texas', tamano: '20', millasIdaDeclaradas: m, pagoCamionRpm: null, tarifaOfrecida: 900 });
  q.push({ destinoRaw: 'Houston', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: 2.0, tarifaOfrecida: 900, costoPorMillaPropio: 1.5 });
  q.push({ destinoRaw: 'Pompano Beach', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: 500, accessorialTriggers: ['overweight', 'prepull'] });
  q.push({ destinoRaw: 'Lake Worth Beach, FL', tamano: '20', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null });
  q.push({ origenRaw: 'PEV', destinoRaw: 'Miami, FL', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null });
  q.push({ origenRaw: 'Port Everglades', destinoRaw: 'Doral', tamano: '45', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null });
  for (const zip of ['75006', '77001', '78521', '79912']) q.push({ destinoRaw: `TX ${zip}`, tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null });
  q.push({ destinoRaw: 'Atlanta, GA', tamano: '40', millasIdaDeclaradas: 50, pagoCamionRpm: null, tarifaOfrecida: null });
  q.push({ destinoRaw: 'Oklahoma City, OK', tamano: '20', millasIdaDeclaradas: 90, pagoCamionRpm: null, tarifaOfrecida: null });
  return q;
}

function runAll() {
  const out: unknown[] = queries().map((p) => { try { return resolveDrayageQuote(p); } catch (e) { return { error: String(e) }; } });
  for (const st of ['FL', 'TX', 'GA', 'OK', null] as const) out.push(resolveAccessorialsForState(st as any, st ?? 'Ohio', null));
  for (const z of ['75006', '78521', '79928', '99999']) out.push(resolveTxZip(z));
  for (const c of ['Miami', 'Doral', 'Houston', 'El Paso', 'Nowhere']) { out.push(resolveCiudad('FL', c)); out.push(resolveCiudad('TX', c)); }
  for (const t of ['pev', 'port everglades', 'mia', 'xyz']) out.push(resolveFlTerminal(t));
  out.push(getRouteCounts());
  return JSON.parse(JSON.stringify(out));
}

Deno.test('regresión: misma respuesta con tarifas de la base que con los JSON (~75 casos)', () => {
  resetAll();
  const antes = runAll();
  assertEquals(getRateSource(), 'json');
  const built = buildFromRows(dbRows());
  assert(built.ok);
  return ensureRatesFromDb(fakeBase44(dbRows())).then((r) => {
    assertEquals(r.source, 'db');
    assertEquals(getRateSource(), 'db');
    const despues = runAll();
    assert(antes.length >= 70, `casos: ${antes.length}`);
    assertEquals(despues, antes);
    resetAll();
  });
});

Deno.test('el chat usa la base: un precio editado cambia la cotización', async () => {
  resetAll();
  const rows = dbRows();
  const i = rows.routes.findIndex((r) => r.route_id === 'fl-local-miami-grupo-100-2');
  const base = resolveDrayageQuote({ destinoRaw: 'Miami, FL', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null }) as any;
  rows.routes[i] = { ...rows.routes[i], precios: rows.routes[i].precios.map((p: any) => p.tamano === '40' ? { ...p, objetivo: 777 } : p) };
  await ensureRatesFromDb(fakeBase44(rows));
  const nuevo = resolveDrayageQuote({ destinoRaw: 'Miami, FL', tamano: '40', millasIdaDeclaradas: null, pagoCamionRpm: null, tarifaOfrecida: null }) as any;
  assertNotEquals(JSON.stringify(nuevo), JSON.stringify(base));
  assert(JSON.stringify(nuevo).includes('777'));
  resetAll();
});

Deno.test('respaldo: base vacía → sigue con los JSON', async () => {
  resetAll();
  const r = await ensureRatesFromDb(fakeBase44({ routes: [], accessorials: [], aliases: [] }));
  assertEquals([r.source, r.reason], ['json', 'base-vacia']);
  assertEquals(getRateSource(), 'json');
  resetAll();
});

Deno.test('respaldo: error de la base → se conservan las tarifas actuales', async () => {
  resetAll();
  const r = await ensureRatesFromDb(fakeBase44('error'));
  assertEquals(r.source, 'json');
  assertEquals(getRouteCounts().total, 272);
  resetAll();
});

Deno.test('respaldo: dato inválido (precio negativo) → se rechaza todo el lote', async () => {
  resetAll();
  const rows = dbRows();
  rows.routes[0] = { ...rows.routes[0], precios: [{ tamano: '40', objetivo: -5, piso_tabla: null, derivado: false }] };
  const r = await ensureRatesFromDb(fakeBase44(rows));
  assertEquals(r.source, 'json');
  assert(r.reason?.startsWith('invalido'));
  assertEquals(getRateSource(), 'json');
  resetAll();
});

Deno.test('ZIP sin ruta: no bloquea la carga y se informa (hoy ya pasa en los JSON)', () => {
  const b = buildFromRows(dbRows());
  assert(b.ok);
  if (b.ok) assertEquals(b.zipSinRuta.length, 48);
});

Deno.test('caché: dentro de 60 s no vuelve a leer la base', async () => {
  resetAll();
  let lecturas = 0;
  const fb = fakeBase44(dbRows());
  const orig = fb.asServiceRole.entities.RateRoute.filter;
  fb.asServiceRole.entities.RateRoute.filter = (...a: any[]) => { lecturas++; return (orig as any)(...a); };
  await ensureRatesFromDb(fb, 1_000);
  assertEquals((await ensureRatesFromDb(fb, 1_000 + RATE_CACHE_TTL_MS - 1)).source, 'cache');
  await ensureRatesFromDb(fb, 1_000 + RATE_CACHE_TTL_MS + 1);
  assertEquals(lecturas, 2);
  resetAll();
});

Deno.test('ruta desactivada en la base → el chat ya no la encuentra por nombre', async () => {
  resetAll();
  const rows = dbRows();
  rows.routes = rows.routes.map((r) => r.ciudad === 'Doral' ? { ...r, activo: false } : r);
  await ensureRatesFromDb(fakeBase44(rows));
  assert(!loadRoutes('FL').some((r) => r.ciudad === 'Doral'));
  resetAll();
});
