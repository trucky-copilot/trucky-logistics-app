// F3-15 · Fase 3 — Empresa y equipos. Reglas puras (sin base de datos) para
// cambiar el nombre de la empresa y los tipos de camión. El nombre lo usa el
// verificador de documentos (F4-07), por eso su cambio pide confirmación
// explícita y queda en un historial con fecha y usuario.
export const TRUCK_TYPES = ['dry_van', 'flatbed', 'reefer', 'drayage'] as const;
export const EDIT_ROLES = ['owner', 'admin'];
export const MAX_HISTORY = 50;

export type NameChange = { anterior: string; nuevo: string; fecha: string; usuario: string };

export const cleanName = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

export type CompanyInput = { nombre?: unknown; tipos_camion?: unknown; confirmar_nombre?: unknown };
export type CompanyPlan =
  | { ok: false; status: number; error: string; requiere_confirmacion?: boolean }
  | { ok: true; orgPatch: Record<string, unknown>; carrierPatch: Record<string, unknown> | null; cambioNombre: NameChange | null };

export function planCompanyChange(org: any, input: CompanyInput, usuario: string, now = new Date()): CompanyPlan {
  const orgPatch: Record<string, unknown> = {};
  let carrierPatch: Record<string, unknown> | null = null;
  let cambioNombre: NameChange | null = null;

  if (input.tipos_camion !== undefined) {
    if (!Array.isArray(input.tipos_camion)) return { ok: false, status: 400, error: 'Tipos de camión inválidos' };
    const tipos = [...new Set(input.tipos_camion.map(String))];
    const malos = tipos.filter((t) => !(TRUCK_TYPES as readonly string[]).includes(t));
    if (malos.length) return { ok: false, status: 400, error: `Tipo de camión no válido: ${malos.join(', ')}` };
    orgPatch.tipos_camion = TRUCK_TYPES.filter((t) => tipos.includes(t));
  }

  if (input.nombre !== undefined) {
    const nuevo = cleanName(input.nombre);
    if (nuevo.length < 2 || nuevo.length > 120) return { ok: false, status: 400, error: 'El nombre de la empresa debe tener entre 2 y 120 caracteres' };
    if (nuevo !== cleanName(org?.name)) {
      if (input.confirmar_nombre !== true) {
        return { ok: false, status: 409, error: 'El cambio de nombre requiere confirmación', requiere_confirmacion: true };
      }
      cambioNombre = { anterior: cleanName(org?.name), nuevo, fecha: now.toISOString(), usuario };
      const prev = Array.isArray(org?.historial_nombre) ? org.historial_nombre : [];
      orgPatch.name = nuevo;
      orgPatch.historial_nombre = [...prev, cambioNombre].slice(-MAX_HISTORY);
      carrierPatch = { company_name: nuevo };
    }
  }

  if (!Object.keys(orgPatch).length) return { ok: false, status: 400, error: 'No hay cambios' };
  return { ok: true, orgPatch, carrierPatch, cambioNombre };
}
