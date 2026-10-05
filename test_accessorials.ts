import { applyCustomAccessorials, filterAccessorialsByTriggers, AccessorialRecord } from './base44/functions/marketChat/rateEngine.ts';

const defaults: AccessorialRecord[] = [
  { concepto: 'Pre-Pull Fee (MIA)', gatillo: 'pre-pull', monto: '100', nota: '', fuente: { archivo: 'test', fila: 1 } },
  { concepto: 'TONU', gatillo: 'tonu', monto: '150', nota: '', fuente: { archivo: 'test', fila: 2 } }
];

const customText1 = 'pre pull: 500';
const customText2 = 'prepull: 500';

console.log("=== Test 1: pre pull: 500 ===");
let merged = applyCustomAccessorials(defaults, customText1);
console.log("Merged:", merged.map(m => m.concepto + ' | ' + m.monto + ' | ' + m.isCustom));

let filtered = filterAccessorialsByTriggers(merged, ['pre-pull']);
console.log("Filtered:", filtered.map(m => m.concepto + ' | ' + m.monto + ' | ' + m.isCustom));

console.log("\n=== Test 2: prepull: 500 ===");
merged = applyCustomAccessorials(defaults, customText2);
console.log("Merged:", merged.map(m => m.concepto + ' | ' + m.monto + ' | ' + m.isCustom));

filtered = filterAccessorialsByTriggers(merged, ['pre-pull']);
console.log("Filtered:", filtered.map(m => m.concepto + ' | ' + m.monto + ' | ' + m.isCustom));
