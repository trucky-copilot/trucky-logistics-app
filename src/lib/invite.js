// PM-03 · Código de referido: enlace de invitación personal.
// Quien invita comparte `…/?invita=CODIGO`. El invitado llega al registro con el
// aviso del bono de la Academia, y al terminar el onboarding su perfil guarda
// `invitado_por`. El beneficio (primer mes del plan de $29) lo sigue dando
// solo el pago con ACADEMY en trucky-ai.com; este enlace no da acceso ni descuento.
const KEY = 'trucky_invita';
const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I/L para que no se confundan
export const CODIGO_VALIDO = /^[A-HJKMNP-Z2-9]{8}$/;

/** Normaliza un código recibido; devuelve null si no tiene la forma esperada. */
export function normalizarCodigo(valor) {
  const c = String(valor || '').trim().toUpperCase();
  return CODIGO_VALIDO.test(c) ? c : null;
}

/** Lee `?invita=` de la URL (si viene) y lo guarda; devuelve la invitación pendiente. */
export function leerInvitacion(search = typeof location !== 'undefined' ? location.search : '') {
  try {
    const c = normalizarCodigo(new URLSearchParams(search).get('invita'));
    if (c) localStorage.setItem(KEY, c);
    return normalizarCodigo(localStorage.getItem(KEY));
  } catch { return null; }
}

export function borrarInvitacion() {
  try { localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
}

/** Código personal nuevo de 8 caracteres. */
export function nuevoCodigo(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return Array.from(random(8), (x) => ABC[x % ABC.length]).join('');
}

export const enlaceInvitacion = (codigo, origin = location.origin) => `${origin}/?invita=${codigo}`;

/**
 * Qué guardar en el perfil del invitado: solo si hay invitación válida, el perfil
 * aún no tiene `invitado_por` y no es su propio código.
 */
export function datosInvitado(invitacion, perfil) {
  const c = normalizarCodigo(invitacion);
  if (!c || perfil?.invitado_por || c === perfil?.codigo_invitacion) return {};
  return { invitado_por: c };
}
