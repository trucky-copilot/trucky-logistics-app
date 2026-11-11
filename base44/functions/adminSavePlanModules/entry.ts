// Ticket 101 · Guarda la matriz "qué módulos ve cada plan" (tabla PlanModule).
// Solo administradores. UPSERT por plan + módulo; nunca borra filas.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { logAndSanitizeError } from '../../shared/safeError.ts';
import { isAppAdmin } from '../../shared/adminAccess.ts';
import { PLANS, MODULES, matrixFromRows, rowKey } from '../../shared/planModules.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async function adminSavePlanModules(req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    let user: any = null;
    try { user = await base44.auth.me(); } catch { /* sin sesión */ }
    if (!isAppAdmin(user)) return json({ error: 'Unauthorized' }, 403);

    const body = await req.json().catch(() => ({}));
    const matrix = body?.matrix;
    if (!matrix || typeof matrix !== 'object') return json({ error: 'Falta la matriz' }, 400);

    const db = base44.asServiceRole.entities;
    const rows = await db.PlanModule.filter({}, 'plan', 200, 0);
    const byKey = new Map<string, any>();
    for (const r of rows || []) if (!byKey.has(rowKey(r.plan, r.module))) byKey.set(rowKey(r.plan, r.module), r);

    let cambios = 0;
    for (const { id: plan } of PLANS) {
      for (const { id: module } of MODULES) {
        const enabled = matrix?.[plan]?.[module];
        if (typeof enabled !== 'boolean') return json({ error: `Valor inválido para ${plan} / ${module}` }, 400);
        const cur = byKey.get(rowKey(plan, module));
        if (!cur) { await db.PlanModule.create({ plan, module, enabled, actualizado_por: user.email }); cambios++; }
        else if (cur.enabled !== enabled) { await db.PlanModule.update(cur.id, { enabled, actualizado_por: user.email }); cambios++; }
      }
    }
    const after = await db.PlanModule.filter({}, 'plan', 200, 0);
    return json({ ok: true, cambios, matrix: matrixFromRows(after) });
  } catch (error) {
    return json(logAndSanitizeError('adminSavePlanModules', error), 500);
  }
}
