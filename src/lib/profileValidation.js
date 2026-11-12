// F3-15 · Validación de Perfil personal (pura, la usa la pantalla y las pruebas).
// MC y DOT se guardan solo con dígitos ("MC-123456" → "123456").

export const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');

export function normalizeProfile(input) {
  return {
    nombre_completo: String(input?.nombre_completo ?? '').trim().replace(/\s+/g, ' '),
    telefono: String(input?.telefono ?? '').trim(),
    mc_number: onlyDigits(input?.mc_number),
    dot_number: onlyDigits(input?.dot_number),
  };
}

// Devuelve { campo: mensaje } solo con los campos con error. Vacío = todo bien.
export function validateProfile(data, locale = 'es') {
  const en = locale === 'en';
  const e = {};
  if (data.nombre_completo.length < 2 || data.nombre_completo.length > 80) {
    e.nombre_completo = en ? 'Enter your full name (2 to 80 characters).' : 'Escribe tu nombre completo (2 a 80 caracteres).';
  }
  if (data.telefono) {
    const digits = onlyDigits(data.telefono);
    if (!/^[+\d\s().-]+$/.test(data.telefono) || digits.length < 7 || digits.length > 15) {
      e.telefono = en ? 'Phone: 7 to 15 digits; you may use +, spaces, dashes and parentheses.' : 'Teléfono: de 7 a 15 dígitos; puedes usar +, espacios, guiones y paréntesis.';
    }
  }
  if (data.mc_number && (data.mc_number.length < 4 || data.mc_number.length > 8)) {
    e.mc_number = en ? 'MC: 4 to 8 digits.' : 'MC: de 4 a 8 dígitos.';
  }
  if (data.dot_number && (data.dot_number.length < 5 || data.dot_number.length > 8)) {
    e.dot_number = en ? 'DOT: 5 to 8 digits.' : 'DOT: de 5 a 8 dígitos.';
  }
  return e;
}
