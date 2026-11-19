// Reglas puras del Verificador (sin IA ni base de datos), probadas en
// tests/analyzeDocument.rules.test.ts.

const PLACEHOLDERS = new Set(['null', 'undefined', 'n/a', 'na', 'none', 'not specified', 'not provided', 'not found',
  'unknown', 'no especificado', 'no encontrado', 'desconocido', '-', '--', 'tbd']);

/** QA (menores): la IA devuelve textos como "Not specified"; se tratan como vacíos para que no salgan en verde. */
export function limpiarPlaceholders(datos: Record<string, unknown>): Record<string, any> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(datos || {})) {
    out[k] = typeof v === 'string' && (v.trim() === '' || PLACEHOLDERS.has(v.trim().toLowerCase())) ? null : v;
  }
  return out;
}

/**
 * F2: fecha + hora del documento → Date. Acepta "08:00", "8:00 AM", "0800", "15:00 hrs"
 * y fechas que ya traen la hora ("11/25/2026 08:00"). Sin hora reconocible → null.
 */
export function fechaConHora(fecha: unknown, hora?: unknown): Date | null {
  const f = String(fecha ?? '').trim();
  if (!f) return null;
  const h = String(hora ?? '').trim();
  // "0800" solo se acepta en el campo de hora (en una fecha, "2026" no es una hora).
  const m = h
    ? h.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b|\b(\d{1,2})\s*(am|pm)\b|^([01]\d|2[0-3])([0-5]\d)\s*(?:hrs?|h)?$/i)
    : f.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b|\b(\d{1,2})\s*(am|pm)\b/i);
  if (!m) return null;
  let hh: number, mm: number, ap: string | undefined;
  if (m[1] !== undefined) { hh = +m[1]; mm = +m[2]; ap = m[3]; }
  else if (m[4] !== undefined) { hh = +m[4]; mm = 0; ap = m[5]; }
  else { hh = +m[6]; mm = +m[7]; }
  if (ap) { const pm = /pm/i.test(ap); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
  if (hh > 23 || mm > 59) return null;
  const soloFecha = f.match(/(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  let d: Date;
  if (soloFecha?.[1]) d = new Date(+soloFecha[1], +soloFecha[2] - 1, +soloFecha[3]);
  else if (soloFecha?.[4]) { const y = +soloFecha[6] < 100 ? 2000 + +soloFecha[6] : +soloFecha[6]; d = new Date(y, +soloFecha[4] - 1, +soloFecha[5]); }
  else { d = new Date(f); if (isNaN(+d)) return null; }
  d.setHours(hh, mm, 0, 0);
  return d;
}

/** Horas entre recogida y entrega usando fecha y hora. null si falta alguna hora (no se puede juzgar la ventana). */
export function ventanaHoras(datos: Record<string, unknown>): number | null {
  const p = fechaConHora(datos.pickup_fecha, datos.pickup_hora);
  const e = fechaConHora(datos.delivery_fecha, datos.delivery_hora);
  if (!p || !e) return null;
  return (+e - +p) / 3600000;
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** F1: ¿el carrier del documento es la propia empresa (nombre de la organización o uno de sus perfiles)? */
export function esEmpresaPropia(carrierDoc: unknown, nombres: unknown[]): boolean {
  const d = norm(carrierDoc);
  if (d.length < 3) return false;
  return nombres.some((n) => {
    const x = norm(n);
    return x.length >= 3 && (d === x || d.includes(x) || x.includes(d));
  });
}

export const soloDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');
