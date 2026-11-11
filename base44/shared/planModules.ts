// ─────────────────────────────────────────────────────────────────────────────
// Ticket 101 · Módulos por plan — UNA sola fuente para servidor y pantalla.
//
// La matriz vive en la tabla PlanModule de Base44 (una fila por plan + módulo,
// con `enabled`). Si la tabla está vacía o no se puede leer, se usa la matriz
// por defecto de abajo. Cambiar qué ve cada plan = editar la tabla (Panel Admin
// → Planes), sin reprogramar.
//
// Por defecto el plan de $29 YA NO incluye el módulo de correo (solo Pro/$99).
// ─────────────────────────────────────────────────────────────────────────────

export type PlanId = 'demo' | 'plan_29' | 'plan_99';
export type ModuleId = 'chat' | 'document_analysis' | 'analyze_in_chat' | 'email_module';
export type PlanMatrix = Record<PlanId, Record<ModuleId, boolean>>;

export const PLANS: { id: PlanId; label: string }[] = [
  { id: 'demo', label: 'Demo' },
  { id: 'plan_29', label: 'Carrier' },
  { id: 'plan_99', label: 'Pro (Flota / Dispatcher)' },
];

export const MODULES: { id: ModuleId; label: string }[] = [
  { id: 'chat', label: 'Chat de mercado' },
  { id: 'document_analysis', label: 'Análisis de documentos' },
  { id: 'analyze_in_chat', label: 'Analizar documentos dentro del chat' },
  { id: 'email_module', label: 'Módulo de correo' },
];

export const DEFAULT_MATRIX: PlanMatrix = {
  demo: { chat: true, document_analysis: true, analyze_in_chat: false, email_module: false },
  plan_29: { chat: true, document_analysis: true, analyze_in_chat: false, email_module: false },
  plan_99: { chat: true, document_analysis: true, analyze_in_chat: true, email_module: true },
};

const isPlan = (p: unknown): p is PlanId => PLANS.some((x) => x.id === p);
const isModule = (m: unknown): m is ModuleId => MODULES.some((x) => x.id === m);

export const rowKey = (plan: string, module: string) => `${plan}:${module}`;

// Filas de la tabla → matriz completa (lo que falte se toma del defecto).
export function matrixFromRows(rows: unknown): PlanMatrix {
  const m = JSON.parse(JSON.stringify(DEFAULT_MATRIX)) as PlanMatrix;
  if (!Array.isArray(rows)) return m;
  for (const r of rows as any[]) {
    const plan: unknown = r?.plan, mod: unknown = r?.module;
    if (isPlan(plan) && isModule(mod) && typeof r?.enabled === 'boolean') m[plan][mod] = r.enabled;
  }
  return m;
}

// Servidor: lectura con caché de 60 s; ante error, la matriz por defecto.
let cache: { at: number; matrix: PlanMatrix } | null = null;
export const PLAN_MATRIX_TTL_MS = 60_000;

export async function loadPlanMatrix(db: any, now = Date.now()): Promise<PlanMatrix> {
  if (cache && now - cache.at < PLAN_MATRIX_TTL_MS) return cache.matrix;
  try {
    const rows = await db.PlanModule.filter({}, 'plan', 200, 0);
    cache = { at: now, matrix: matrixFromRows(rows) };
  } catch {
    cache = { at: now, matrix: matrixFromRows([]) };
  }
  return cache.matrix;
}

export function resetPlanMatrixCache() { cache = null; }

// ¿El plan incluye el módulo? Admin siempre sí.
export function planAllows(matrix: PlanMatrix, plan: string, module: ModuleId): boolean {
  if (plan === 'admin') return true;
  return isPlan(plan) ? matrix[plan][module] === true : false;
}
