// F3-15 · Fase 6 — Reglas puras de la solicitud de eliminación de cuenta
// (probadas en tests/accountDeletion.test.ts). No borra nada: registra la
// solicitud y avisa a soporte, que la revisa y la ejecuta.

export const SUPPORT_EMAIL_DEFAULT = 'trucky.road.copilot@gmail.com';
export const CONFIRM_WORDS = ['ELIMINAR', 'DELETE'];
export const MAX_MOTIVO = 500;

export type Validacion = { ok: true; motivo: string } | { ok: false; code: string };

export function validarSolicitud(body: unknown): Validacion {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const palabra = String(b.confirmacion ?? '').trim().toUpperCase();
  if (!CONFIRM_WORDS.includes(palabra)) return { ok: false, code: 'CONFIRMATION_REQUIRED' };
  const motivo = String(b.motivo ?? '').replace(/<[^>]*>?/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_MOTIVO);
  return { ok: true, motivo };
}

export function mensajeSoporte(d: { usuario: string; organizacion?: string | null; organizationId?: string | null; rol?: string | null; motivo?: string; fecha: string }) {
  const subject = `Solicitud de eliminación de cuenta · ${d.usuario}`;
  const body = [
    'Un usuario solicitó eliminar su cuenta de Trucky desde Configuración → Privacidad y datos.',
    '',
    `Usuario: ${d.usuario}`,
    `Empresa: ${d.organizacion || '—'}${d.organizationId ? ` (${d.organizationId})` : ''}`,
    `Rol: ${d.rol || '—'}`,
    `Fecha: ${d.fecha}`,
    `Motivo: ${d.motivo || '(sin motivo)'}`,
    '',
    'La solicitud quedó registrada en Base44 → Datos → AccountDeletionRequest (estado: pendiente).',
    'Antes de borrar, confirma con el usuario y revisa si hay una suscripción activa en Stripe.',
  ].join('\n');
  return { subject, body };
}
