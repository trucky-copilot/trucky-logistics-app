// ─────────────────────────────────────────────────────────────────────────────
// CONVERSOR Excel → tarifas — reglas-v3-multiestado, Fase 1 / F6-01.
//
// Convierte las hojas del Excel oficial (Rates_Drayage + Accesoriales para FL,
// Rates_Drayage_TX + Accesoriales_TX para TX) a la forma de las tablas.
// Lo usan: la función adminSaveRates (Excel subido en Panel Admin → Tarifas) y
// el script offline tools/convertRateTables.ts (regenera shared/rateData/*.json).
// Vive en shared/ para que Base44 lo publique con cada función.
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

// Las hojas llegan ya leídas como filas (`sheet_to_json(sheet, { header: 1,
// defval: null })`): en la pantalla las lee el navegador y en el script offline
// (tools/convertRateTables.ts) la librería xlsx. Así ninguna función de Base44
// depende de la librería de Excel.
export type SheetRows = Record<string, unknown[][]>;

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

// F6-01 Fase E: también se usa desde adminSaveRates (Excel subido desde la
// pantalla Tarifas), por eso convertFlorida/convertTexas/sha256Bytes se exportan.
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}


function readSheetRows(sheets: SheetRows, sheetName: string): unknown[][] {
  const rows = sheets?.[sheetName];
  if (!Array.isArray(rows)) throw new Error(`No existe la hoja "${sheetName}" en el archivo`);
  return rows;
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

export function convertFlorida(sheets: SheetRows, archivo: string, sha: string): {
  routes: RouteRecord[];
  accessorials: AccessorialRecord[];
} {
  const rows = readSheetRows(sheets, 'Rates_Drayage');
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
      { tamano: '40', objetivo: num(r[6])!, piso_tabla: null, derivado: false },
      { tamano: '45', objetivo: num(r[7])!, piso_tabla: null, derivado: false },
      { tamano: '20_heavy', objetivo: num(r[8])!, piso_tabla: null, derivado: false },
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

  const accRows = readSheetRows(sheets, 'Accesoriales');
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

export function convertTexas(sheets: SheetRows, archivo: string, sha: string): {
  routes: RouteRecord[];
  accessorials: AccessorialRecord[];
} {
  const rows = readSheetRows(sheets, 'Rates_Drayage_TX');
  const routes: RouteRecord[] = [];

  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    const ciudad = str(r?.[2]);
    if (!ciudad) continue;

    const mercado = str(r[0]);
    const zona = str(r[1]);
    const millasIda = num(r[3]); // Columna D
    const piso20 = num(r[4]);
    const obj20 = num(r[5]);
    const piso40 = num(r[6]);
    const obj40 = num(r[7]);
    const nota = str(r[9]) || undefined;

    if (millasIda === null || (piso40 === null && obj40 === null && piso20 === null && obj20 === null)) {
      throw new Error(`TX fila ${i + 1} (${ciudad}): faltan millas o todas las tarifas — no se carga con un dato inventado`);
    }

    const precios: RoutePriceEntry[] = [];
    if (obj20 !== null && isFinite(obj20)) {
      precios.push({ tamano: '20', objetivo: obj20, piso_tabla: piso20 !== null ? piso20 : null, derivado: false });
    }
    if (obj40 !== null && isFinite(obj40)) {
      precios.push({ tamano: '40', objetivo: obj40, piso_tabla: piso40 !== null ? piso40 : null, derivado: false });
    }

    routes.push({
      id: slugify('tx', zona, ciudad, mercado, i),
      estado: 'TX',
      mercado,
      ciudad,
      zona,
      grupo: null,
      millas_ida: millasIda,
      precios,
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

  const accRows = readSheetRows(sheets, 'Accesoriales_TX');
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
