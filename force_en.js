const fs = require('fs');
const p = 'base44/functions/analyzeDocument/entry.ts';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(/const { documentText, selectedCarrierId, locale = 'es' } = await req\.json\(\);/,
  "const { documentText, selectedCarrierId } = await req.json();\n    const locale = 'en'; // FORCED BY SCRIPT");

c = c.replace(/const RULES_VERSION = '2\.0\.1';/, "const RULES_VERSION = '2.0.2';"); // Force cache bust again

fs.writeFileSync(p, c);
console.log('Forced locale to EN in entry.ts and bumped RULES_VERSION');
