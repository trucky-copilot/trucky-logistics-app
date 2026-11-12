// F3-15 / QA 3-nov: datos del remitente para la firma de los correos.
// Salen del Perfil personal (UserProfile: nombre, teléfono, MC, DOT) y, si
// faltan, del CarrierProfile de la empresa. La empresa es SIEMPRE la de la
// cuenta (los perfiles de trabajo no tienen empresa propia).
// fillSenderFields() es una red de seguridad determinista: después del LLM
// rellena o quita los campos de la firma que hayan quedado sin llenar.
export type Sender = { nombre: string; empresa: string; mc: string; dot: string; telefono: string; email: string };

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

export function senderData(o: { userProfile?: any; carrierProfile?: any; organizationName?: string | null; user?: any }): Sender {
  const up = o.userProfile || {};
  const cp = o.carrierProfile || {};
  let empresa = clean(cp.company_name) || clean(o.organizationName);
  if (/^desconocido$/i.test(empresa)) empresa = '';
  let mc = digits(up.mc_number) || digits(cp.mc_number);
  // Si el MC quedó escrito como nombre de la empresa en el registro ("MC 123456").
  if (!mc && /^MC\b/i.test(empresa)) mc = digits(empresa);
  return {
    nombre: clean(up.nombre_completo) || clean(o.user?.full_name),
    empresa,
    mc,
    dot: digits(up.dot_number) || digits(cp.dot_number),
    telefono: clean(up.telefono),
    email: clean(o.user?.email),
  };
}

/** Campos del remitente que faltan (para avisar al usuario dónde completarlos). */
export const missingSenderFields = (s: Sender) =>
  (['nombre', 'mc', 'dot', 'telefono'] as const).filter((k) => !s[k]);

const PLACEHOLDER = /\(Configura tu Carrier Profile\)|NO_DISPONIBLE|\[(?:MC|DOT|phone|Phone|teléfono|Teléfono)\]/;

/** Rellena/limpia la firma: línea "MC# … | DOT# …", línea de teléfono, nombre, empresa y correo. */
export function fillSenderFields(text: string, s: Sender): string {
  let out = String(text ?? '');
  out = out.replace(/\[Your name\]|\[Tu nombre\]/g, s.nombre || '[Your name]');
  out = out.replace(/\[Company\]|\[Empresa\]/g, s.empresa || '[Company]');
  out = out.replace(/\[email\]|\[correo\]/gi, s.email || '[email]');

  const lines = out.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    // Línea de firma "MC# x | DOT# y" (la del broker es "MC#: [MC]" con dos puntos y no se toca).
    if (/^MC#\s*[^:]/i.test(t) && /\|\s*DOT#/i.test(t)) {
      const parts = [s.mc ? `MC# ${s.mc}` : '', s.dot ? `DOT# ${s.dot}` : ''].filter(Boolean);
      if (parts.length) result.push(parts.join(' | '));
      continue;
    }
    // "[Company] · MC# [MC]" (plantilla de seguimiento).
    if (/·\s*MC#/.test(t) && PLACEHOLDER.test(t)) {
      result.push(s.mc ? t.replace(/MC#\s*\S.*$/, `MC# ${s.mc}`) : t.replace(/\s*·\s*MC#.*$/, ''));
      continue;
    }
    // Línea de teléfono de la firma.
    const tel = t.match(/^(Phone|Teléfono|Telefono|Tel\.?|Celular|Cell)\s*:\s*(.*)$/i);
    if (tel) {
      const val = tel[2].trim();
      if (!val || PLACEHOLDER.test(val)) { if (s.telefono) result.push(`${tel[1]}: ${s.telefono}`); continue; }
    }
    result.push(line);
  }
  return result.join('\n');
}
