// F3-15 · Fase 5 — Plantillas de correo propias. El usuario puede reemplazar
// la plantilla oficial de uno o varios escenarios; en los demás el chat sigue
// usando la predeterminada (F3-09). Funciones puras: el chat las usa para
// armar la lista de plantillas y la nota "Plantilla usada: …".
export type Template = { id: string; name: string; description: string; subject?: string; body: string };
export type Merged = Template & { propia: boolean };

export const MAX_SUBJECT = 200;
export const MAX_BODY = 5000;

/** Filas propias válidas (escenario conocido, cuerpo no vacío); si hay varias del mismo escenario, la más reciente. */
export function mergeTemplates(defaults: Template[], custom: any[]): Merged[] {
  const ids = new Set(defaults.map((d) => d.id));
  const byId = new Map<string, any>();
  const fecha = (r: any) => Date.parse(r?.updated_date || r?.created_date || '') || 0;
  for (const r of custom || []) {
    const body = typeof r?.cuerpo === 'string' ? r.cuerpo.trim() : '';
    if (!ids.has(r?.escenario) || !body) continue;
    const prev = byId.get(r.escenario);
    if (!prev || fecha(r) >= fecha(prev)) byId.set(r.escenario, r);
  }
  return defaults.map((d) => {
    const r = byId.get(d.id);
    if (!r) return { ...d, propia: false };
    const subject = typeof r.asunto === 'string' && r.asunto.trim() ? r.asunto.trim().slice(0, MAX_SUBJECT) : d.subject;
    return { ...d, subject, body: String(r.cuerpo).trim().slice(0, MAX_BODY), propia: true };
  });
}

/** Nota que el chat agrega debajo del correo para indicar qué plantilla usó. */
export function templateUsageNote(merged: Merged[], id: unknown, locale: string): string {
  const t = merged.find((m) => m.id === id);
  if (!t) return '';
  const nombre = t.name.replace(/^\d+\.\s*/, '');
  if (locale === 'en') return `_Template used: ${nombre} · ${t.propia ? 'your own' : 'default'}_`;
  return `_Plantilla usada: ${nombre} · ${t.propia ? 'tuya' : 'predeterminada'}_`;
}
