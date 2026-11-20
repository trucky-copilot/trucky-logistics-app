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
