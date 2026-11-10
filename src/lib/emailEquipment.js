// QA: equipo detectado en el correo (40' reefer, 20' overweight, 1x40 HC, chasis tri-axle…).
// Funciones puras (sin React) para poder probarlas.

// Encabezados que abren una lista de accesoriales / cargos a cotizar.
const ACCESSORIAL_HEADING = /(accessorial|accesorial|additional\s+(charges|fees|costs)|extra\s+(charges|fees)|cargos\s+adicionales|(please\s+)?(also\s+)?(include|quote|advise|share)\s+(us\s+)?(the\s+)?(following\s+)?(accessorials?|charges|fees|extras)|(charges|fees)\s+(if\s+)?(apply|applicable))/i;
const LIST_ITEM = /^\s*(?:[-*•·▪◦]|\d+[.)]|[a-z][.)])\s+/i;
const ACCESSORIAL_ITEM = /^\s*(tri-?\s*ax\w*|overweight|over\s*weight|chass[iy]s|pre-?\s*pull|storage|per\s*diem|detention|waiting|split|hazmat|haz\b|toll|flip|dry\s*run|layover|demurrage|yard|stop\s*off|reefer\s*(plug|monitoring|genset)|genset)/i;
const TYPICAL_ACCESSORIAL = /\b(pre-?\s*pull|storage|per\s*diem|detention|waiting\s*time|chassis\s*split|split\s*chassis|demurrage|toll|flip|dry\s*run|layover|stop\s*off|genset)\b/i;
const FEE_WORD = /\b(fee|fees|charge|charges|surcharge|cost|costs|rate|rates)\b/i;

/**
 * Quita del texto lo que solo es una lista de cargos a cotizar, para no
 * etiquetar la carga con equipo que no lleva (p. ej. "tri-axle chassis",
 * "Overweight fee" dentro de la lista de accesoriales).
 */
export function stripAccessorials(text) {
  const lines = String(text || '').split(/\r?\n/);
  const kept = [];
  let inSection = false, removed = 0;
  for (const line of lines) {
    if (ACCESSORIAL_HEADING.test(line)) { inSection = true; removed = 0; continue; }
    if (inSection) {
      if (!line.trim()) { if (removed > 0) inSection = false; continue; }
      if (LIST_ITEM.test(line) || FEE_WORD.test(line) || ACCESSORIAL_ITEM.test(line)) { removed++; continue; }
      inSection = false;
    }
    kept.push(line);
  }
  // Lista con viñetas sin encabezado claro: si es una lista de cargos (algún ítem
  // menciona fee/charge o un accesorial típico como pre-pull, storage o per diem),
  // se quita entera; una lista con los datos de la carga se conserva.
  const out = [];
  for (let i = 0; i < kept.length;) {
    if (!LIST_ITEM.test(kept[i])) { out.push(kept[i++]); continue; }
    let j = i; while (j < kept.length && LIST_ITEM.test(kept[j])) j++;
    const block = kept.slice(i, j);
    const isCharges = block.length >= 2 && block.some(l => FEE_WORD.test(l) || TYPICAL_ACCESSORIAL.test(l));
    if (!isCharges) out.push(...block);
    i = j;
  }
  // Menciones sueltas de un cargo: "overweight fee", "tri-axle chassis fee", "heavy weight surcharge".
  return out.join('\n')
    .replace(/\b(tri-?\s*ax\w*|overweight|over\s*weight|heavy(\s*weight)?)(\s+chass[iy]s)?\s*[:\-]?\s*(fee|fees|charge|charges|surcharge|cost|rate)s?\b/gi, ' ');
}

const SIZE_TYPE = /\b(?:\d+\s*[x×*]\s*)?(20|40|45|53)\s*(?:'|’|"|ft\b|-?\s*foot|-?\s*feet)?\s*(hc|hq|high\s*cube|gp|dc|std|rf)\b/gi;
const SIZE_PLAIN = /\b(?:\d+\s*[x×*]\s*)?(20|40|45|53)\s*(?:'|’|"|ft\b|-?\s*foot|-?\s*feet|pies)/gi;

function normType(raw) {
  const t = raw.toUpperCase().replace(/\s+/g, '');
  return t === 'HQ' || t === 'HIGHCUBE' ? 'HC' : t;
}

export function detectEquipment(email) {
  const raw = `${email?.asunto || ''}\n${email?.cuerpo || email?.snippet || ''}`;
  const t = stripAccessorials(raw);
  const out = [];
  const sizes = new Map();
  for (const m of t.matchAll(SIZE_TYPE)) sizes.set(m[1], `${m[1]}' ${normType(m[2])}`);
  for (const m of t.matchAll(SIZE_PLAIN)) if (!sizes.has(m[1])) sizes.set(m[1], `${m[1]}'`);
  out.push(...sizes.values());
  if (/\breefer\b|\breef\b|refrigerat|\brf\b/i.test(t)) out.push('Reefer');
  if (/flat\s*-?bed|step\s*-?deck/i.test(t)) out.push('Flatbed');
  if (/dry\s*-?van/i.test(t)) out.push('Dry van');
  if (/tri-?\s*ax[le]+/i.test(t)) out.push('Tri-axle');
  else if (/\bchassis\b|\bchasis\b/i.test(t)) out.push('Chassis');
  // "Legal weight" / "(LEGAL W)" declara peso legal: no es overweight.
  const legalWeight = /\blegal\s*(weight|wt|w)\b/i.test(t);
  if (!legalWeight && /overweight|over\s+weight|\bheavy\b|\b[6-9]\d,?\d{3}\s*lbs/i.test(t)) out.push('Overweight');
  if (!out.length && /drayage|container|contenedor/i.test(t)) out.push('Container');
  return [...new Set(out)].slice(0, 4);
}
