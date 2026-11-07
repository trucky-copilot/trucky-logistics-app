// Captura el código de vinculación de facturación (#billing_link=<64 hex>)
// ANTES que cualquier otro módulo: main.jsx lo importa primero, así ni el SDK
// de Base44, ni la autenticación, ni el router pueden redirigir o reescribir
// la URL y perderlo. El código se borra de la barra de direcciones de
// inmediato y solo vive en memoria (nunca en localStorage/sessionStorage ni
// en logs).
let code = null;

if (typeof window !== 'undefined') {
  try {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('billing_link');
    if (value) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
      if (/^[a-f0-9]{64}$/.test(value)) code = value;
    }
  } catch { /* sin enlace */ }
}

export function peekBillingLinkCode() {
  return code;
}

export function clearBillingLinkCode() {
  code = null;
}
