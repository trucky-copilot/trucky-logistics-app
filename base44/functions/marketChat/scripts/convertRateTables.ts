// ─────────────────────────────────────────────────────────────────────────────
// CONVERSOR OFFLINE Excel → JSON — reglas-v3-multiestado, Fase 1.
//
// Corre UNA SOLA VEZ, a mano, para regenerar los JSON versionados que vive en
// ../data/*.json. NO es parte del runtime: entry.ts y rateEngine.ts NUNCA lo
// importan (grep-verificado en apply-progress). No hay importador en tiempo
// de ejecución — fuera de alcance de este SDD (kickoff §8).
//
// Uso (desde la raíz del repo):
//   DENO_NO_PACKAGE_JSON=1 deno run --allow-read --allow-write --allow-net --allow-env \
//     base44/functions/marketChat/scripts/convertRateTables.ts \
//     --fl <ruta a Trucky_Flat_Rates_Drayage_FL_v6.xlsx> \
//     --tx <ruta a Trucky_Flat_Rates_Drayage_TX_v1.xlsx>
//
// DENO_NO_PACKAGE_JSON=1 es necesario porque el repo tiene package.json/
// node_modules (proyecto npm): sin esa variable, Deno intenta resolver
// "npm:xlsx" contra node_modules local en vez de bajarlo, y falla porque no
// está instalado ahí (no hace falta agregarlo a package.json — es una
// dependencia SOLO de este script offline, no del runtime).
//
// --allow-net hace falta solo para que Deno resuelva "npm:xlsx" (se cachea
// después de la primera corrida); el script no hace ninguna llamada de red
// con los datos.
//
// Principio de esta conversión: CARGAR TAL CUAL, nunca inventar ni ajustar.
// - Las columnas "OO ... — NO EN USO" y "Margen % — NO EN USO" NO se leen.
// - Waiting Time se copia literal de la hoja ($75/hora) — v6 ya no necesita el
//   override curado que usaban versiones previas.
// - FL ya trae los 4 tamaños (20'/40'/45'/20' Heavy) como columnas de precio
//   explícitas — no se derivan acá; Texas solo trae 40' nativo (la derivación
//   de 20'/45'/20' Heavy de Texas es Fase 3, sizeDerivation.ts, y NO corre en
//   este script).
// ─────────────────────────────────────────────────────────────────────────────

import XLSX from 'npm:xlsx@0.18.5';

interface RoutePriceEntry {
  tamano: '20' | '40' | '45' | '20_heavy';
  objetivo: number;
  piso_tabla: number | null;
  derivado: boolean;
}

interface RouteRecord {
  id: string;
  estado: 'FL' | 'TX';
  mercado: string;
  ciudad: string;
  zona: string;
  grupo: string | number | null;
  millas_ida: number;
  precios: RoutePriceEntry[];
  fuente: { archivo: string; sha: string; fila: number; nota_original?: string };
  semantica_millas: {
    tipo_millas: 'ida' | 'ida_y_vuelta';
    precio_incluye_regreso: boolean;
    nota: string;
  };
}

interface AccessorialRecord {
  concepto: string;
  gatillo: string | null;
  monto: string;
  nota: string | null;
  fuente: { archivo: string; fila: number };
}

function slugify(...partes: Array<string | number | null | undefined>): string {
  return partes
    .filter(p => p !== null && p !== undefined && p !== '')
    .join('-')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function sha256File(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function readSheetRows(workbook: XLSX.WorkBook, sheetName: string): unknown[][] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`No existe la hoja "${sheetName}" en el archivo`);
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
}

function num(value: unknown): number | null {
  return typeof value === 'number' && isFinite(value) ? value : null;
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// FLORIDA
// ─────────────────────────────────────────────────────────────────────────────

function convertFlorida(workbook: XLSX.WorkBook, archivo: string, sha: string): {
  routes: RouteRecord[];
  accessorials: AccessorialRecord[];
} {
  const rows = readSheetRows(workbook, 'Rates_Drayage');
  const routes: RouteRecord[] = [];

  // fila 0 = título de la hoja, fila 1 = encabezados, datos desde fila 2.
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    const ciudad = str(r?.[2]);
    if (!ciudad) continue; // filas vacías / notas al pie de la tabla — no son rutas.

    const zona = str(r[0]);
    const mercado = str(r[1]); // "Puerto": MIA | PEV | Ambos
    const millasIda = num(r[3]);
    const grupo = str(r[4]) || null;

    if (millasIda === null) {
      throw new Error(`FL fila ${i + 1} (${ciudad}): "Millas" no es un número — no se carga con un dato inventado`);
    }

    const precios: RoutePriceEntry[] = [
      { tamano: '20', objetivo: num(r[5])!, piso_tabla: null, derivado: false },
      { tamano: '40', objetivo: num(r[8])!, piso_tabla: null, derivado: false },
      { tamano: '45', objetivo: num(r[10])!, piso_tabla: null, derivado: false },
      { tamano: '20_heavy', objetivo: num(r[12])!, piso_tabla: null, derivado: false },
    ];
    for (const p of precios) {
      if (p.objetivo === null || !isFinite(p.objetivo)) {
        throw new Error(`FL fila ${i + 1} (${ciudad}): precio de tamaño ${p.tamano} no es un número — se detiene la conversión en vez de cargar un dato inventado`);
      }
    }

    routes.push({
      id: slugify('fl', zona, ciudad, grupo, i),
      estado: 'FL',
      mercado,
      ciudad,
      zona,
      grupo,
      millas_ida: millasIda,
      precios,
      fuente: { archivo, sha, fila: i + 1 },
      semantica_millas: {
        tipo_millas: 'ida',
        precio_incluye_regreso: true,
        nota: 'Columna "Millas" de la hoja es de ida; el precio (CT) ya incluye el regreso — confirmado por la nota de multiplicadores de tamaño de la propia hoja ("mismo movimiento, más peso/chasis") y por la columna "Base" = "RT (round trip)" presente en todas las filas.',
      },
    });
  }

  const accRows = readSheetRows(workbook, 'Accesoriales');
  const accessorials: AccessorialRecord[] = [];
  for (let i = 2; i < accRows.length; i++) {
    const r = accRows[i];
    const concepto = str(r?.[0]);
    if (!concepto) continue;
    accessorials.push({
      concepto,
      gatillo: str(r[1]) || null,
      monto: str(r[2]),
      nota: str(r[3]) || null,
      fuente: { archivo, fila: i + 1 },
    });
  }

  return { routes, accessorials };
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXAS
// ─────────────────────────────────────────────────────────────────────────────

function convertTexas(workbook: XLSX.WorkBook, archivo: string, sha: string): {
  routes: RouteRecord[];
  accessorials: AccessorialRecord[];
} {
  const rows = readSheetRows(workbook, 'Rates_Drayage_TX');
  const routes: RouteRecord[] = [];

  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    const ciudad = str(r?.[2]);
    if (!ciudad) continue;

    const mercado = str(r[0]);
    const zona = str(r[1]);
    const millasIda = num(r[4]);
    const piso = num(r[5]);
    const objetivo = num(r[6]);
    const nota = str(r[9]) || undefined;

    if (millasIda === null || piso === null || objetivo === null) {
      throw new Error(`TX fila ${i + 1} (${ciudad}): faltan millas/piso/objetivo — no se carga con un dato inventado`);
    }

    routes.push({
      id: slugify('tx', zona, ciudad, mercado, i),
      estado: 'TX',
      mercado,
      ciudad,
      zona,
      grupo: null, // TX no tiene columna de grupo de tarifa — la tarifa es directa por ciudad/zona.
      millas_ida: millasIda,
      precios: [
        { tamano: '40', objetivo, piso_tabla: piso, derivado: false },
      ],
      fuente: { archivo, sha, fila: i + 1, ...(nota ? { nota_original: nota } : {}) },
      semantica_millas: {
        tipo_millas: 'ida',
        // ADVERTENCIA (ver apply-progress lote 1, sección de riesgos): la
        // columna "RPM aprox (RT)" de la propia hoja se aproxima en la
        // mayoría de las filas a objetivo ÷ (millas_ida × 2), lo cual podría
        // sugerir que "objetivo" YA es un cargo de ida y vuelta — igual que en
        // Florida. Se deja como false (Design decision explícita: TX no
        // declara que el precio incluya el regreso) hasta que Fase 3 confirme
        // la semántica correcta antes de construir el cálculo de RPM sobre
        // este campo. NO cambiar este valor sin re-verificar contra la hoja.
        precio_incluye_regreso: false,
        nota: 'Columna "Millas (ida)" de la hoja, declarada explícitamente de ida. precio_incluye_regreso=false por definición de Design; PENDIENTE DE CONFIRMAR: la columna "RPM aprox (RT)" de la hoja se acerca a objetivo÷(millas_ida×2) en casi todas las filas, lo que podría indicar lo contrario. Ver riesgo en apply-progress antes de que Fase 3 use este campo para calcular RPM.',
      },
    });
  }

  const accRows = readSheetRows(workbook, 'Accesoriales_TX');
  const accessorials: AccessorialRecord[] = [];
  for (let i = 2; i < accRows.length; i++) {
    const r = accRows[i];
    const concepto = str(r?.[0]);
    if (!concepto) continue;
    accessorials.push({
      concepto,
      gatillo: null, // la hoja de TX no trae columna de gatillo separada.
      monto: str(r[1]),
      nota: str(r[2]) || null,
      fuente: { archivo, fila: i + 1 },
    });
  }

  return { routes, accessorials };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(args: string[]): { fl: string; tx: string } {
  const get = (flag: string): string | null => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : null;
  };
  const fl = get('--fl');
  const tx = get('--tx');
  if (!fl || !tx) {
    throw new Error('Uso: convertRateTables.ts --fl <ruta FL v6.xlsx> --tx <ruta TX v1.xlsx>');
  }
  return { fl, tx };
}

async function main() {
  const { fl: flPath, tx: txPath } = parseArgs(Deno.args);

  const flSha = await sha256File(flPath);
  const txSha = await sha256File(txPath);

  const flWorkbook = XLSX.readFile(flPath);
  const txWorkbook = XLSX.readFile(txPath);

  const flArchivo = flPath.split('/').pop()!;
  const txArchivo = txPath.split('/').pop()!;

  const fl = convertFlorida(flWorkbook, flArchivo, flSha);
  const tx = convertTexas(txWorkbook, txArchivo, txSha);

  if (fl.routes.length !== 209) {
    throw new Error(`Integridad: se esperaban 209 rutas FL, se convirtieron ${fl.routes.length}`);
  }
  if (tx.routes.length !== 50) {
    throw new Error(`Integridad: se esperaban 50 rutas TX, se convirtieron ${tx.routes.length}`);
  }

  const dataDir = new URL('../data/', import.meta.url);
  await Deno.mkdir(dataDir, { recursive: true });

  const write = async (name: string, value: unknown) => {
    await Deno.writeTextFile(new URL(name, dataDir), JSON.stringify(value, null, 2) + '\n');
    console.log(`escrito: ${name}`);
  };

  await write('routes.fl.json', fl.routes);
  await write('routes.tx.json', tx.routes);
  await write('accessorials.fl.json', fl.accessorials);
  await write('accessorials.tx.json', tx.accessorials);

  console.log(`\nOK — FL: ${fl.routes.length} rutas, ${fl.accessorials.length} accesoriales`);
  console.log(`OK — TX: ${tx.routes.length} rutas, ${tx.accessorials.length} accesoriales`);
}

if (import.meta.main) {
  await main();
}
