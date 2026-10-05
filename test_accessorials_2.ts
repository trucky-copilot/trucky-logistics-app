import { AccessorialRecord } from './base44/functions/marketChat/rateEngine.ts';

export function normalizeText(value: unknown): string {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function applyCustomAccessorials(
  defaults: AccessorialRecord[],
  customText: string | null | undefined
): AccessorialRecord[] {
  if (!customText) return defaults.map(d => ({ ...d, isCustom: false }));

  // Mock parseCustomAccessorials
  const customs = customText.split('\n').map(line => {
    const match = line.match(/^([^:$]+)[:\s]+(.+)$/);
    if (match) return { concepto: match[1].trim(), monto: match[2].trim() };
    return null;
  }).filter(Boolean) as any[];

  if (!customs.length) return defaults.map(d => ({ ...d, isCustom: false }));

  const merged = [...defaults.map(d => ({ ...d, isCustom: false }))];

  for (const c of customs) {
    const cNorm = normalizeText(c.concepto).replace(/[-\s]+/g, '');
    let replaced = false;
    
    for (let i = 0; i < merged.length; i++) {
      const dNormConcept = normalizeText(merged[i].concepto).replace(/[-\s]+/g, '');
      if (dNormConcept.includes(cNorm) || cNorm.includes(dNormConcept)) {
        merged[i] = {
          ...merged[i],
          concepto: merged[i].concepto.replace(/\s*\([A-Z]+\)/i, ''),
          monto: c.monto,
          isCustom: true
        };
        replaced = true;
      }
    }

    if (!replaced) {
      merged.push({
        concepto: c.concepto,
        gatillo: c.concepto,
        monto: c.monto,
        nota: "Custom",
        fuente: { archivo: "user", fila: 0 },
        isCustom: true
      });
    }
  }

  return merged;
}

export function filterAccessorialsByTriggers(
  items: AccessorialRecord[], 
  triggers: unknown, 
  origenCiudad?: string | null
): AccessorialRecord[] {
  if (!Array.isArray(triggers) || triggers.length === 0) return [];
  const normalizados = triggers.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map(normalizeText);
  if (normalizados.length === 0) return [];

  const matched = items.filter(item => {
    const campo = normalizeText(`${item.concepto} ${item.gatillo ?? ''}`).replace(/[-\s]+/g, '');
    
    if (campo.includes('prepull')) {
      return normalizados.some(t => {
        const tNorm = t.replace(/[-\s]+/g, '');
        return (tNorm.includes('pre') || tNorm.includes('pull')) && campo.includes(tNorm);
      });
    }

    return normalizados.some(t => campo.includes(t.replace(/[-\s]+/g, '')));
  });

  const finalItems: AccessorialRecord[] = [];
  let hasPrePull = false;

  const isPEV = origenCiudad ? (normalizeText(origenCiudad).includes('lauderdale') || normalizeText(origenCiudad).includes('everglades') || normalizeText(origenCiudad).includes('pev')) : false;
  const isMIA = origenCiudad ? normalizeText(origenCiudad).includes('miami') : false;

  for (const item of matched) {
    const c = normalizeText(item.concepto).replace(/[-\s]+/g, '');
    if (c.includes('prepull')) {
      if (hasPrePull) continue; 
      
      if (c.includes('mia') && isPEV && !isMIA) continue;
      if (c.includes('pev') && isMIA && !isPEV) continue;

      hasPrePull = true;
    }
    finalItems.push(item);
  }

  return finalItems;
}


const defaults: AccessorialRecord[] = [
  { concepto: 'Pre-Pull Fee (MIA)', gatillo: 'pre-pull', monto: '100', nota: '', fuente: { archivo: 'test', fila: 1 } },
  { concepto: 'TONU', gatillo: 'tonu', monto: '150', nota: '', fuente: { archivo: 'test', fila: 2 } }
];

const customText1 = 'pre pull: 500';
const customText2 = 'prepull: 500';

console.log("=== Test 1: pre pull: 500 ===");
let merged = applyCustomAccessorials(defaults, customText1);
let filtered = filterAccessorialsByTriggers(merged, ['pre-pull']);
console.log("Filtered:", filtered.map(m => m.concepto + ' | ' + m.monto + ' | ' + m.isCustom));

console.log("\n=== Test 2: prepull: 500 ===");
merged = applyCustomAccessorials(defaults, customText2);
filtered = filterAccessorialsByTriggers(merged, ['pre-pull']);
console.log("Filtered:", filtered.map(m => m.concepto + ' | ' + m.monto + ' | ' + m.isCustom));
