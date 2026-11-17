// QA 13-nov: el destinatario del borrador se prellena con el correo del broker
// identificado. 1) campo email de la tabla Broker; 2) si no tiene, el correo del
// remitente con ese nombre en la bandeja de la empresa (el más reciente).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function pickBrokerEmail(found: any, rawName: string, inbox: any[]): string {
  const direct = String(found?.email || '').trim();
  if (EMAIL_RE.test(direct)) return direct;
  const name = String(found?.nombre || rawName || '').trim().toLowerCase();
  if (!name) return '';
  const fecha = (e: any) => Date.parse(e?.fecha || e?.created_date || '') || 0;
  const match = (inbox || [])
    .filter((e) => String(e?.remitente_nombre || '').toLowerCase().includes(name) && EMAIL_RE.test(String(e?.remitente_email || '')))
    .sort((a, b) => fecha(b) - fecha(a))[0];
  return match ? String(match.remitente_email).trim() : '';
}

export async function findBrokerEmail(base44: any, orgId: string, found: any, rawName: string): Promise<string> {
  const direct = pickBrokerEmail(found, rawName, []);
  if (direct || !orgId) return direct;
  const inbox = await base44.entities.Email.filter({ organization_id: orgId }, '-fecha', 200);
  return pickBrokerEmail(found, rawName, inbox || []);
}
