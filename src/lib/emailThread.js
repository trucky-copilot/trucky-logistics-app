// Utilidades del hilo de correo (Emails), probadas en tests/emailThread.test.mjs.

/**
 * Separa lo nuevo de un mensaje del texto citado de respuestas anteriores
 * ("> …", "On … wrote:", "El … escribió:", "--- Original Message ---"), como Gmail.
 */
export function splitQuoted(body = '') {
  const text = String(body || '').replace(/\r/g, '');
  const lines = text.split('\n');
  const esCabecera = (l) => /(wrote|escribi[oó]):\s*$/i.test(l.trim()) || /^-{2,}\s*(original message|mensaje original)/i.test(l.trim());
  let corte = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^>/.test(t) || esCabecera(t)) { corte = i; break; }
    // "El jue, 19 nov 2026 a las 15:07, Luis (<x@y.com>)" + "escribió:" en la línea siguiente
    if (/^(on|el)\s/i.test(t) && i + 1 < lines.length && esCabecera(lines[i + 1])) { corte = i; break; }
  }
  if (corte < 0) return { nuevo: text.trim(), citado: '' };
  const nuevo = lines.slice(0, corte).join('\n').trim();
  const citado = lines.slice(corte).join('\n').trim();
  return nuevo ? { nuevo, citado } : { nuevo: text.trim(), citado: '' };
}
