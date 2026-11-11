// F6-01 · Fase B — Migración de las tablas de tarifas (JSON del repo) a la base.
//
// Solo administradores (rol de la plataforma). Tres acciones:
//   - "preview" (por defecto): no escribe nada; dice cuántas filas crearía,
//     cuáles cambiarían y por qué campos.
//   - "apply": crea lo que falta (con soloVacias:true, solo en tablas vacías:
//     así la llama sola la pantalla la primera vez). Lo que ya existe y es distinto NO se pisa
//     salvo que se envíe overwriteChanged:true (así una re-ejecución no borra
//     ediciones hechas desde la pantalla). Cada escritura queda en RateChangeLog.
//   - "verify": reconstruye desde la base la forma que usa el chat y la compara
//     con los JSON; ok:true significa 0 diferencias.
// Nunca borra registros.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { logAndSanitizeError } from '../../shared/safeError.ts';
import { isAppAdmin } from '../../shared/adminAccess.ts';
import { seedAll, planUpsert, verifyAgainstSeed, type CatalogEntity } from '../../shared/rateCatalog.ts';

const ENTITIES: CatalogEntity[] = ['RateZone', 'RateRoute', 'RateAccessorial', 'RateAlias'];
const PAGE = 500;
const CHUNK = 100;

async function readAll(db: any, entity: string): Promise<any[]> {
  const out: any[] = [];
  for (let skip = 0; ; skip += PAGE) {
    const page = await db[entity].filter({}, 'orden', PAGE, skip);
    const rows = Array.isArray(page) ? page : [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async function adminMigrateRates(req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    let user: any = null;
    try { user = await base44.auth.me(); } catch { /* sin sesión */ }
    if (!isAppAdmin(user)) return json({ error: 'Unauthorized' }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? 'preview';
    const overwriteChanged = body?.overwriteChanged === true;
    // Carga inicial automática (Panel Admin → Tarifas drayage): solo llena las
    // tablas que estén completamente vacías; nunca toca ni revive lo editado.
    const soloVacias = body?.soloVacias === true;
    const db = base44.asServiceRole.entities;

    const current = {} as Record<CatalogEntity, any[]>;
    for (const e of ENTITIES) current[e] = await readAll(db, e);

    if (action === 'verify') return json({ action, ...verifyAgainstSeed(current) });

    const seed = seedAll();
    const loteId = `migracion-${new Date().toISOString()}`;
    const resumen: Record<string, unknown> = {};

    for (const e of ENTITIES) {
      const plan = planUpsert(e, seed[e], current[e]);
      resumen[e] = {
        crear: plan.create.length,
        cambiarian: plan.update.length,
        iguales: plan.unchanged,
        clavesDuplicadasEnBase: plan.duplicatedKeysInDb,
        ejemplosCambios: plan.update.slice(0, 10).map((u) => ({ clave: u.key, campos: u.campos })),
      };
      if (action !== 'apply') continue;
      if (soloVacias && current[e].length > 0) { (resumen[e] as any).omitida = true; continue; }

      const audit = { actualizado_por: user.email, origen: 'migracion' };
      for (let i = 0; i < plan.create.length; i += CHUNK) {
        await db[e].bulkCreate(plan.create.slice(i, i + CHUNK).map((r) => ({ ...r, ...audit })));
      }
      const updates = overwriteChanged ? plan.update : [];
      for (const u of updates) await db[e].update(u.id, { ...u.despues, ...audit });

      // Un solo registro por tabla en el historial (no uno por fila).
      const logs = [
        ...(plan.create.length ? [{ entidad: e, registro_key: 'carga-inicial', accion: 'crear', antes: null, despues: { registros: plan.create.length, origen: 'tarifas del sistema (JSON del repo)' }, campos: [], usuario_email: user.email, origen: 'migracion', lote_id: loteId }] : []),
        ...updates.map((u) => ({ entidad: e, registro_key: u.key, accion: 'actualizar', antes: u.antes, despues: u.despues, campos: u.campos, usuario_email: user.email, origen: 'migracion', lote_id: loteId })),
      ];
      for (let i = 0; i < logs.length; i += CHUNK) await db.RateChangeLog.bulkCreate(logs.slice(i, i + CHUNK));
      (resumen[e] as any).actualizados = updates.length;
    }

    return json({ action, overwriteChanged, lote_id: action === 'apply' ? loteId : null, resumen });
  } catch (error) {
    return json(logAndSanitizeError('adminMigrateRates', error), 500);
  }
}
