// QA: términos de transporte que Google Translate traduce mal desde el español.
const GLOSARIO_EN = [
  [/\bTotal fee\b/g, 'Total rate'],
  [/\btotal fee\b/g, 'total rate'],
  [/\bFees?\b(?=\s*(?:per|\/|\$|:|calculated|estimated|below|above|of\s*\$))/g, 'Rate'],
  [/\bfees?\b(?=\s*(?:per|\/|\$|:|calculated|estimated|below|above|of\s*\$))/g, 'rate'],
  [/\b(\d+) charges\b/g, '$1 loads'],
  [/\b1 charge\b/g, '1 load'],
];
export const glosarioEn = (s) => GLOSARIO_EN.reduce((t, [re, v]) => t.replace(re, v), String(s ?? ''));
