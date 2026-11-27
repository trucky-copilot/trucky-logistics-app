// PM-03 · Código de referido: enlace de invitación personal.
// Quien invita comparte `https://www.trucky-ai.com/?invita=CODIGO`. La web de pago
// envía el código a Stripe y, al activarse el plan, Base44 marca la empresa del
// invitado como referida (Organization.referido_por). El enlace no da acceso ni
// descuento: el primer mes gratis sigue siendo solo el código ACADEMY en el pago.
const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I/L para que no se confundan
export const CODIGO_VALIDO = /^[A-HJKMNP-Z2-9]{8}$/;
export const WEB_PAGO = 'https://www.trucky-ai.com';

/** Normaliza un código; devuelve null si no tiene la forma esperada. */
export function normalizarCodigo(valor) {
  const c = String(valor || '').trim().toUpperCase();
  return CODIGO_VALIDO.test(c) ? c : null;
}

/** Código personal nuevo de 8 caracteres. */
export function nuevoCodigo(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return Array.from(random(8), (x) => ABC[x % ABC.length]).join('');
}

export const enlaceInvitacion = (codigo) => `${WEB_PAGO}/?invita=${codigo}`;
