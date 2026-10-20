// Prueba unitaria rápida del filtro logístico

const LOGISTICS_KEYWORDS = [
  'load', 'freight', 'rate', 'lane', 'reefer', 'dry van', 'drayage', 'flatbed',
  'container', 'chassis', 'detention', 'layover', 'tonu', 'bol', 'bill of lading',
  'rate confirmation', 'rate con', 'delivery order', 'proof of delivery', 'pod',
  'lumper', 'carrier', 'broker', 'dispatcher', 'dispatch', 'pickup', 'delivery',
  'origin', 'destination', 'mc#', 'mc number', 'dot#', 'factoring', 'quickpay',
  'invoice', 'settlement', 'deadhead', 'all-in', 'rpm', 'flete', 'carga', 'camion',
  'remolque', 'orden de entrega', 'carta porte'
];

const EXCLUSION_KEYWORDS = [
  'mamá', 'mama', 'papá', 'papa', 'hijo', 'hija', 'familia', 'abuelo', 'abuela',
  'netflix', 'spotify', 'steam', 'playstation', 'xbox', 'disney+', 'prime video',
  'hbo', 'twitch', 'uber eats', 'rappi', 'pedidosya', 'casino', 'lotería',
  'reserva de hotel', 'vuelo vacacional', 'cena familiar'
];

function classifyEmail(subject: string, text: string) {
  const content = `${subject || ''} ${text || ''}`.toLowerCase();
  const tieneExclusion = EXCLUSION_KEYWORDS.some(k => content.includes(k));
  const matchesLogistics = LOGISTICS_KEYWORDS.filter(k => content.includes(k));

  if (tieneExclusion && matchesLogistics.length < 2) {
    return { es_logistico: false, categoria: 'general' };
  }

  if (matchesLogistics.length > 0) {
    let categoria = 'cargas';
    if (content.includes('trailer') || content.includes('chassis') || content.includes('truck') || content.includes('camion')) {
      categoria = 'equipos';
    } else if (content.includes('broker') || content.includes('packet') || content.includes('setup')) {
      categoria = 'brokers';
    }
    return { es_logistico: true, categoria };
  }

  return { es_logistico: false, categoria: 'general' };
}

// Casos de prueba
const tests = [
  { subject: 'LOAD AVAILABLE: Miami to Tampa - 53 Dry Van', text: 'Rate $1400 all in, pickup tomorrow at 8am', expected: true },
  { subject: 'Hola hijo cómo estás', text: 'Te escribe mamá para saber de la cena familiar este domingo', expected: false },
  { subject: 'Tu suscripción a Netflix vence pronto', text: 'Renueva tu plan mensual de entretenimiento', expected: false },
  { subject: 'Rate Confirmation - Load #94821 C.H. Robinson', text: 'Please sign and send back BOL upon delivery', expected: true },
  { subject: 'Tu pedido de Uber Eats fue entregado', text: 'Disfruta tu comida', expected: false },
  { subject: 'Trailer 40ft Chassis inspection due', text: 'Maintenance report for equipment fleet', expected: true }
];

let allPassed = true;
for (const t of tests) {
  const res = classifyEmail(t.subject, t.text);
  const ok = res.es_logistico === t.expected;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] "${t.subject}" -> es_logistico=${res.es_logistico} (esperado: ${t.expected})`);
  if (!ok) allPassed = false;
}

if (allPassed) {
  console.log('\nTodos los casos de prueba del filtro pasaron exitosamente!');
} else {
  Deno.exit(1);
}
