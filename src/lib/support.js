// F3-15 · Fase 6 — Canal de soporte y documentos legales.
export const SUPPORT_EMAIL = 'trucky.road.copilot@gmail.com';
export const legalUrl = (doc, locale) =>
  `https://www.trucky-ai.com/${doc === 'terms' ? 'terms' : 'privacy'}?lang=${locale === 'en' ? 'en' : 'es'}`;

/** Enlace mailto a soporte con el correo de la cuenta y la sección desde donde escribe. */
export function supportMailto({ locale, email = '', asunto = '' } = {}) {
  const en = locale === 'en';
  const subject = asunto || (en ? 'Trucky support' : 'Soporte Trucky');
  const body = en
    ? `Hi Trucky team,\n\n[Describe your question or problem here]\n\n---\nAccount: ${email}`
    : `Hola equipo de Trucky,\n\n[Describe aquí tu consulta o problema]\n\n---\nCuenta: ${email}`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// PM-03 · Bono de la Academia: primer mes del plan de $29 gratis, una vez por cuenta.
// El código se valida en la página de pago (trucky-ai.com) y en Stripe; aquí solo se muestra.
export const ACADEMY_CODE = 'ACADEMY';
export const ACADEMY_URL = 'https://www.trucky-ai.com';
