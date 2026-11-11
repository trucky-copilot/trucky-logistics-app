// CONVERSOR OFFLINE Excel → JSON (base44/shared/rateData/*.json).
// La lógica de conversión vive en base44/shared/rateExcel.ts (la misma que usa
// la pantalla Tarifas); este script solo lee los .xlsx del disco.
//
// Uso (desde la raíz del repo):
//   DENO_NO_PACKAGE_JSON=1 deno run --allow-read --allow-write --allow-net --allow-env \
//     tools/convertRateTables.ts --fl <Excel FL> --tx <Excel TX>
import XLSX from 'npm:xlsx@0.18.5';
import { convertFlorida, convertTexas, sha256Bytes, type SheetRows } from '../base44/shared/rateExcel.ts';

function toSheets(wb: XLSX.WorkBook): SheetRows {
  const out: SheetRows = {};
  for (const n of wb.SheetNames) out[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null }) as unknown[][];
  return out;
}

async function sha256File(path: string): Promise<string> {
  return sha256Bytes(await Deno.readFile(path));
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

  const flWorkbook = toSheets(XLSX.readFile(flPath));
  const txWorkbook = toSheets(XLSX.readFile(txPath));

  const flArchivo = flPath.split('/').pop()!;
  const txArchivo = txPath.split('/').pop()!;

  const fl = convertFlorida(flWorkbook, flArchivo, flSha);
  const tx = convertTexas(txWorkbook, txArchivo, txSha);

  if (fl.routes.length === 0) {
    throw new Error(`Error: se convirtieron 0 rutas FL. Revisa el archivo.`);
  }
  if (tx.routes.length === 0) {
    throw new Error(`Error: se convirtieron 0 rutas TX. Revisa el archivo.`);
  }

  console.log(`Integridad superada: ${fl.routes.length} rutas FL, ${tx.routes.length} rutas TX`);

  const dataDir = new URL('../base44/shared/rateData/', import.meta.url);
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
