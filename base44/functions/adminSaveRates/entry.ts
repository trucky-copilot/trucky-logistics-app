// F6-01 · Fase E — única puerta de escritura de tarifas.
//
// Solo administradores (rol admin en Base44 + correo en shared/adminAccess.ts).
// Acciones:
//   preview / apply             → cambios manuales desde la pantalla Tarifas
//   previewExcel / applyExcel   → Excel FL o TX (mismo conversor que generó las tablas)
// Siempre: 1) se lee el estado actual, 2) se arma y valida el plan
// (shared/rateEdits.ts), 3) preview lo devuelve; apply lo ejecuta SOLO si no
// hay errores y si nadie cambió los datos desde la vista previa (firma).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { logAndSanitizeError } from '../../shared/safeError.ts';
import { isAppAdmin } from '../../shared/adminAccess.ts';
import { KEY_FIELD, type CatalogEntity } from '../../shared/rateCatalog.ts';
import { planManual, planExcel, type Plan } from '../../shared/rateEdits.ts';
import { readDb, firmaDe, strip, execute } from '../../shared/rateApply.ts';
import { convertFlorida, convertTexas, type SheetRows } from '../../shared/rateExcel.ts';

const MAX_ROWS = 20000;   // suma de filas de todas las hojas
const MAX_COLS = 60;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

class UserError extends Error {}

// El navegador lee el Excel y manda sus hojas como filas (sheet_to_json con
// header:1, defval:null). Aquí solo se verifica la forma y se convierte con el
// mismo conversor que generó las tablas originales.
function parseExcel(estado: string, fileName: unknown, sha: unknown, sheets: unknown) {
  if (!sheets || typeof sheets !== 'object' || Array.isArray(sheets)) throw new UserError('Falta el archivo');
  let total = 0;
  for (const rows of Object.values(sheets as Record<string, unknown>)) {
    if (!Array.isArray(rows)) throw new UserError('El archivo llegó dañado');
    total += rows.length;
    for (const r of rows) {
      if (r != null && !Array.isArray(r)) throw new UserError('El archivo llegó dañado');
      if (Array.isArray(r) && (r.length > MAX_COLS || r.some((c) => c !== null && typeof c === 'object'))) throw new UserError('El archivo llegó dañado');
    }
  }
  if (total > MAX_ROWS) throw new UserError('El archivo es demasiado grande');
  const archivo = String(fileName || 'archivo.xlsx').split(/[\\/]/).pop()!.slice(0, 120);
  const firma = /^[0-9a-f]{64}$/.test(String(sha)) ? String(sha) : '';
  try {
    return estado === 'FL' ? convertFlorida(sheets as SheetRows, archivo, firma) : convertTexas(sheets as SheetRows, archivo, firma);
  } catch (e) {
    // Los errores del conversor son mensajes propios ("No existe la hoja ...", "FL fila N ...").
    throw new UserError(`No se pudo leer el Excel de ${estado}: ${(e as Error).message}`);
  }
}




const resumen = (p: Plan) => ({ crear: p.crear.length, actualizar: p.actualizar.length, eliminar: p.eliminar.length, iguales: p.iguales, errores: p.errores.length });

// Respuesta liviana para la pantalla (sin los registros completos repetidos).
const forClient = (p: Plan) => ({
  crear: p.crear.map((c) => ({ entidad: c.entidad, key: c.key, resumen: c.resumen, despues: c.resumen ? undefined : strip(c.despues) })),
  actualizar: p.actualizar.map((u) => ({ entidad: u.entidad, key: u.key, campos: u.campos, antes: u.antes, despues: u.despues })),
  eliminar: p.eliminar.map((d) => ({ entidad: d.entidad, key: d.key, resumen: d.resumen ?? Object.values(strip(d.antes) || {}).filter((v) => typeof v === 'string').slice(0, 3).join(' · ') })),
  iguales: p.iguales,
  errores: p.errores,
  avisos: p.avisos,
  calidad: p.calidad,
});

export default async function adminSaveRates(req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    let user: any = null;
    try { user = await base44.auth.me(); } catch { /* sin sesión */ }
    if (!isAppAdmin(user)) return json({ error: 'Unauthorized' }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');
    const db = base44.asServiceRole.entities;
    const current = await readDb(db);
    const firma = firmaDe(current);

    let plan: Plan;
    let origen: 'manual' | 'excel';
    if (action === 'preview' || action === 'apply') {
      const entity = body?.entity as CatalogEntity;
      if (!KEY_FIELD[entity]) return json({ error: 'Tabla no válida' }, 400);
      plan = planManual(entity, body?.changes, current);
      origen = 'manual';
    } else if (action === 'previewExcel' || action === 'applyExcel') {
      const estado = body?.estado;
      if (estado !== 'FL' && estado !== 'TX') return json({ error: 'Estado no válido' }, 400);
      const incoming = parseExcel(estado, body?.fileName, body?.sha, body?.sheets);
      plan = planExcel(estado, incoming as any, current, body?.eliminarFaltantes === true);
      origen = 'excel';
    } else {
      return json({ error: 'Acción no válida' }, 400);
    }

    if (!action.startsWith('apply')) return json({ action, firma, resumen: resumen(plan), ...forClient(plan) });

    if (plan.errores.length) return json({ action, resumen: resumen(plan), ...forClient(plan) }, 422);
    if (body?.firma !== firma) {
      return json({ action, errores: [{ mensaje: 'Los datos cambiaron desde la vista previa (otro administrador guardó algo). Vuelve a revisar los cambios.' }] }, 409);
    }
    await execute(db, plan, user.email, origen);
    return json({ action, ok: true, resumen: resumen(plan) });
  } catch (error) {
    if (error instanceof UserError) return json({ errores: [{ mensaje: error.message }] }, 400);
    return json(logAndSanitizeError('adminSaveRates', error), 500);
  }
}
