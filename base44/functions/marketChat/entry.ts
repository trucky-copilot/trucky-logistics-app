import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─────────────────────────────────────────────────────────────────────────────
// FREIGHT DISPATCHER KNOWLEDGE — Constantes de datos (fuente de la verdad para
// los cálculos de rate_check; el LLM NUNCA produce estos números).
// EQUIPMENT_BENCHMARKS y FLAT_MINIMUMS:
// copiado de src/lib/freight/freightKnowledgeBase.js v1.0.0 (2026-05-13) — mantener en sync manualmente
// ─────────────────────────────────────────────────────────────────────────────
const FREIGHT_KB_VERSION = '1.0.0';

// 7 equipos — id usado también como valor del enum "equipo" en EXTRACTION_SCHEMA
const EQUIPMENT_BENCHMARKS = [
  { id: 'dry_van', label: "53' Dry Van", rpm_min: 2.00, rpm_target: 2.50 },
  { id: 'reefer', label: 'Reefer', rpm_min: 2.30, rpm_target: 2.80 },
  { id: 'flatbed', label: 'Flatbed', rpm_min: 2.50, rpm_target: 3.00 },
  { id: 'step_deck', label: 'Step Deck', rpm_min: 2.75, rpm_target: 3.25 },
  { id: 'drayage_20', label: "Drayage/Container 20'", rpm_min: 2.75, rpm_target: 3.50 },
  { id: 'drayage_40', label: "Drayage/Container 40'", rpm_min: 2.50, rpm_target: 3.25 },
  { id: 'power_only', label: 'Power Only', rpm_min: 1.50, rpm_target: 1.75 },
];

// Mínimos flat rate por rango de millas REDONDO; from/to son límites [from, to) para lookup en código
const FLAT_MINIMUMS = [
  { range: '<50 mi', from: 0, to: 50, min: 400, max: 500 },
  { range: '50–100 mi', from: 50, to: 100, min: 500, max: 650 },
  { range: '100–200 mi', from: 100, to: 200, min: 650, max: 900 },
  { range: '200–400 mi', from: 200, to: 400, min: 900, max: 1400 },
  { range: '400–600 mi', from: 400, to: 600, min: 1400, max: 1800 },
  { range: '600–800 mi', from: 600, to: 800, min: 1800, max: 2400 },
  { range: '800+ mi', from: 800, to: Infinity, min: 2400, max: null },
];

// LANES: catálogo Larcofer (millas REDONDO) — copiado del BASE_CONTEXT vigente, no de freightKnowledgeBase.js
// (freightKnowledgeBase.js no tiene lanes específicas de Larcofer). El catálogo gana sobre la estimación del LLM.
const LANES = [
  { origen: 'Miami', destino: 'Tampa', rt_miles: 540 },
  { origen: 'Miami', destino: 'Fort Myers/Naples', rt_miles: 240, destino_aliases: ['fort myers', 'ft myers', 'naples'] },
  { origen: 'Miami', destino: 'West Palm Beach', rt_miles: 136, destino_aliases: ['wpb', 'west palm beach'] },
  { origen: 'Miami', destino: 'Fort Pierce', rt_miles: 230, destino_aliases: ['ft pierce'] },
  { origen: 'Miami', destino: 'Orlando', rt_miles: 470 },
  { origen: 'Miami', destino: 'Jacksonville', rt_miles: 680, destino_aliases: ['jax'] },
  { origen: 'Miami', destino: 'Pompano', rt_miles: 70, destino_aliases: ['pompano beach'] },
];

// Port Everglades es un MODIFICADOR (+$50 recargo de puerto), no una lane aparte.
const PORT_EVERGLADES_SURCHARGE = 50;

// DETENTION unificado — único valor válido en todo el prompt (resuelve las 3 cifras contradictorias previas)
const DETENTION = { standard: 75, min: 50, max: 100, free_hours: 2 };

const ACCESSORIALS = [
  { label: 'TONU', min: 150, max: 300 },
  { label: 'Pre-Pull', min: 100, max: 200 },
  { label: 'Chassis split', min: 75, max: 75, unit: '/día' },
  { label: 'Storage', min: 75, max: 150, unit: '/día' },
];

const EQUIPMENT_LINES = EQUIPMENT_BENCHMARKS
  .map(e => `- ${e.id} (${e.label}): Mín $${e.rpm_min.toFixed(2)} | Bueno $${e.rpm_target.toFixed(2)}/mi`)
  .join('\n');

const LANE_LINES = LANES
  .map(l => `- Miami ↔ ${l.destino}: ~${l.rt_miles} mi redondo`)
  .join('\n');

const FLAT_MIN_LINE = FLAT_MINIMUMS
  .map(b => `${b.range}=$${b.min.toLocaleString('en-US')}${b.max ? '-$' + b.max.toLocaleString('en-US') : '+'}`)
  .join(' | ');

const ACCESSORIALS_LINE = ACCESSORIALS
  .map(a => a.min === a.max
    ? `${a.label} $${a.min}${a.unit || ''}`
    : `${a.label} $${a.min}-${a.max}${a.unit || ''}`)
  .join(' | ');

const BASE_CONTEXT = `Eres TruckyAI, el asistente de inteligencia de mercado para Larcofer USA, empresa de drayage intermodal en Miami, FL.

[Freight Dispatcher KB v${FREIGHT_KB_VERSION}]

VOCABULARIO DEL MERCADO (siempre interpreta correctamente):
- FIT = Florida International Terminal (Medley/Hialeah, zona de PortMiami)
- SFST = South Florida Staging Terminal
- Pompano = Pompano Beach, FL
- WPB = West Palm Beach, FL
- drayage = transporte de contenedores desde/hacia puerto
- rate confirmation / red confirmation = rate confirmation (documento de tarifa)
- backhaul = carga de regreso vacío
- detention = cobro por espera excesiva en puerto o cliente
- per diem = cargo diario por uso de contenedor del naviero
- demurrage = cargo por contenedor que sigue en puerto después de free days
- void check = cheque anulado para configurar pago ACH/EFT con broker
- TONU = Truck Order Not Used (cuando el broker cancela después de confirmar)

EMPRESA:
- Larcofer USA, Miami FL — Drayage intermodal
- Puertos: PortMiami, Port Everglades (Fort Lauderdale)
- Rutas principales: Tampa, Fort Myers/Naples, WPB, Fort Pierce, Pompano, Orlando, Jacksonville

EQUIPOS Y BENCHMARKS RPM (7 tipos — usa estos IDs exactos al extraer "equipo"):
${EQUIPMENT_LINES}

LANES LARCOFER (catálogo; millas REDONDO = ida + vuelta, salvo que el dispatcher diga "solo ida"/"one way"):
${LANE_LINES}
- Port Everglades (Fort Lauderdale) se trata como zona base de Miami; agrega +$${PORT_EVERGLADES_SURCHARGE} de recargo de puerto — NO es una ruta aparte.

MÍNIMOS FLAT RATE (el piso real siempre es el MAYOR entre este mínimo y RPM mínimo del equipo × millas): ${FLAT_MIN_LINE}

DETENTION: único valor válido en toda respuesta — $${DETENTION.standard}/hr estándar tras ${DETENTION.free_hours}h libres (rango $${DETENTION.min}-$${DETENTION.max}/hr). NUNCA menciones otra cifra de detention.
ACCESSORIALS: ${ACCESSORIALS_LINE}

DEADHEAD: <20% millas cargadas=OK | 20-40%=Preocupante | >40%=Deal-breaker. Si deadhead >100mi, pedir $1.00-$1.50/mi adicional.

HOS: 11h conducción diaria | 14h on-duty | Pausa 30min tras 8h conduciendo | 70h/8días o 60h/7días.

REGLAS CRÍTICAS DE RESPUESTA (aplican solo a "respuesta_general" — los cálculos de tarifa de rate_check se hacen en código, no aquí):
1. Respuestas MUY CORTAS — máximo 5 líneas. El dispatcher no quiere leer párrafos.
2. NUNCA sugerir "busca carga de regreso" — eso lo maneja el dispatcher, no el broker.
3. NUNCA inventes cifras de tarifas, millas o mínimos que no estén en esta KB — si no las tienes, dilo.
4. Para preguntas que no son de ruta, responde en máximo 3 líneas.`;

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA DE EXTRACCIÓN — Único InvokeLLM del handler devuelve exactamente esto.
// El código NO confía ciegamente en enum/formato: normaliza defensivamente
// (ver normalizeEquipment/resolveMiles) por si el LLM se desvía del schema.
// ─────────────────────────────────────────────────────────────────────────────
const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['rate_check', 'general'] },
    origen: { type: 'string' },
    destino: { type: 'string' },
    millas_ida: { type: 'number' },
    es_redondo: { type: 'boolean' },
    equipo: {
      type: 'string',
      enum: ['dry_van', 'reefer', 'flatbed', 'step_deck', 'drayage_20', 'drayage_40', 'power_only', 'unknown'],
    },
    tarifa_ofrecida: { type: 'number' },
    respuesta_general: { type: 'string' },
  },
};

async function extractIntent(base44, prompt) {
  return await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: EXTRACTION_SCHEMA,
  });
}

// Una sola llamada InvokeLLM + un reintento único si falla o si el resultado no es un objeto parseable.
// Si ambos intentos fallan, retorna null y el caller usa safeFallbackContent().
async function extractWithRetry(base44, prompt) {
  for (let intento = 0; intento < 2; intento++) {
    try {
      const raw = await extractIntent(base44, prompt);
      if (raw && typeof raw === 'object') return raw;
    } catch (_error) {
      // se reintenta una sola vez; si el segundo intento también lanza, se sale del loop con null
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCIONES PURAS DE CÁLCULO — Sin IA, sin I/O. El piso/objetivo/veredicto de
// rate_check SIEMPRE se calculan aquí (resuelve BUG-01); el LLM solo extrae
// parámetros crudos.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeText(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function matchesAny(text, tokens) {
  return tokens.some(t => t && text.includes(t));
}

const MIAMI_TOKENS = ['miami'];
const PORT_EVERGLADES_TOKENS = ['port everglades', 'fort lauderdale', 'ft lauderdale'];
const BASE_TOKENS = [...MIAMI_TOKENS, ...PORT_EVERGLADES_TOKENS];

// Busca la lane catalogada cuyo destino coincide con el extremo no-Miami de la consulta.
// Port Everglades cuenta como extremo "base" (zona de Miami) para efectos de matching de lane,
// pero además activa el recargo de puerto.
function findLane(origenRaw, destinoRaw) {
  const a = normalizeText(origenRaw);
  const b = normalizeText(destinoRaw);
  const portEverglades = matchesAny(a, PORT_EVERGLADES_TOKENS) || matchesAny(b, PORT_EVERGLADES_TOKENS);
  const aEsBase = matchesAny(a, BASE_TOKENS);
  const bEsBase = matchesAny(b, BASE_TOKENS);

  let cityText = '';
  if (aEsBase && !bEsBase) cityText = b;
  else if (bEsBase && !aEsBase) cityText = a;

  if (!cityText) return { lane: null, portEverglades };

  const lane = LANES.find(l => {
    const tokens = [normalizeText(l.destino), ...(l.destino_aliases || [])];
    return tokens.some(t => t && (cityText.includes(t) || t.includes(cityText)));
  }) || null;

  return { lane, portEverglades };
}

// Resuelve millas RT: catálogo Larcofer gana sobre la estimación del LLM.
// Sin match en catálogo y sin millas_ida del LLM → insufficient=true (pedir aclaración, nunca inventar).
function resolveMiles(origen, destino, millasIda, esRedondo) {
  const { lane, portEverglades } = findLane(origen, destino);
  const redondo = esRedondo !== false; // true por defecto

  if (lane) {
    const miles = redondo ? lane.rt_miles : Math.round(lane.rt_miles / 2);
    return { miles, source: 'catalog', lane_label: `Miami ↔ ${lane.destino}`, low_confidence: false, portEverglades, insufficient: false };
  }

  if (typeof millasIda === 'number' && isFinite(millasIda) && millasIda > 0) {
    const rt = redondo ? millasIda * 2 : millasIda;
    const miles = Math.round(rt);
    const low_confidence = miles < 10 || miles > 3000;
    return { miles, source: 'llm', lane_label: null, low_confidence, portEverglades, insufficient: false };
  }

  return { miles: null, source: 'llm', lane_label: null, low_confidence: false, portEverglades, insufficient: true };
}

function normalizeEquipment(raw) {
  const found = EQUIPMENT_BENCHMARKS.find(e => e.id === raw);
  if (found) return { ...found, was_defaulted: false };
  const fallback = EQUIPMENT_BENCHMARKS.find(e => e.id === 'dry_van');
  return { ...fallback, was_defaulted: true };
}

function getFlatBucket(miles) {
  return FLAT_MINIMUMS.find(b => miles >= b.from && miles < b.to) || FLAT_MINIMUMS[FLAT_MINIMUMS.length - 1];
}

// Regla de oro (BUG-01): piso = MAYOR entre flat mínimo del tramo y RPM mínimo del equipo × millas RT.
function computeFloor(miles, rpmMin, flatMin, surcharge = 0) {
  return Math.max(flatMin, Math.round(rpmMin * miles)) + surcharge;
}

function computeTarget(miles, rpmTarget, flatMax, surcharge = 0) {
  return Math.max(flatMax ?? 0, Math.round(rpmTarget * miles)) + surcharge;
}

function computeVerdict(tarifa, floor, target) {
  if (tarifa == null) return { emoji: '📊', label: 'REFERENCIA', band: 'reference' };
  if (tarifa < floor) return { emoji: '🔴', label: 'RECHAZAR', band: 'reject' };
  if (tarifa < target) return { emoji: '🟡', label: 'NEGOCIAR', band: 'negotiate' };
  return { emoji: '🟢', label: 'ACEPTAR', band: 'accept' };
}

function formatUSD(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// Desglose numérico SIEMPRE presente (resuelve BUG-03): piso, objetivo, RPM ofrecida vs mínima, diferencia en $.
function buildRateCheckMarkdown(ctx) {
  const { origen, destino, miles, esRedondo, laneLabel, source, lowConfidence, equipment, floor, target, tarifaOfrecida, portEverglades } = ctx;

  const rutaLabel = origen && destino ? `${origen} → ${destino}` : (laneLabel || 'Ruta solicitada');
  // "millas estimadas" se muestra siempre que la milla venga del LLM (no del catálogo Larcofer);
  // "confianza baja" es una señal adicional para estimaciones fuera del rango de sanidad (10–3000 mi).
  const millasTag = `~${miles} mi ${esRedondo === false ? 'solo ida' : 'redondo'}${source === 'llm' ? ' · millas estimadas' : ''}${lowConfidence ? ' · confianza baja' : ''}`;
  const equipoTag = `${equipment.label}${equipment.was_defaulted ? ' (asumido dry van)' : ''}`;
  const puertoTag = portEverglades ? ` · +$${PORT_EVERGLADES_SURCHARGE} recargo Port Everglades incluido` : '';
  const mercadoLine = `💰 Mercado: $${equipment.rpm_min.toFixed(2)}–$${equipment.rpm_target.toFixed(2)}/mi · Equipo: ${equipoTag}`;

  if (tarifaOfrecida == null) {
    return [
      `📊 **REFERENCIA** | Piso: ${formatUSD(floor)} | Objetivo: ${formatUSD(target)}`,
      `📍 ${rutaLabel} (${millasTag}${puertoTag})`,
      mercadoLine,
      `💡 Confirma origen, destino, millas y equipo para afinar la cifra.`,
      `¿Cuánto te ofrecen? Te digo si conviene.`,
    ].join('\n');
  }

  const rpmOfrecida = miles > 0 ? tarifaOfrecida / miles : 0;
  const verdict = computeVerdict(tarifaOfrecida, floor, target);
  const diferencia = tarifaOfrecida - floor;
  const posicion = tarifaOfrecida < floor ? 'bajo el piso' : (tarifaOfrecida < target ? 'entre piso y objetivo' : 'sobre objetivo');
  const consejo = verdict.band === 'reject'
    ? `Bajo el piso; contrarresta en ${formatUSD(floor)} mínimo.`
    : verdict.band === 'negotiate'
      ? `Negocia hacia ${formatUSD(target)}; hay margen.`
      : 'Buena tarifa, confirma el RC rápido.';

  return [
    `${verdict.emoji} **${verdict.label}** | Piso: ${formatUSD(floor)} | Objetivo: ${formatUSD(target)}`,
    `📍 ${rutaLabel} (${millasTag}${puertoTag})`,
    mercadoLine,
    `🧮 Ofrecen ${formatUSD(tarifaOfrecida)} = $${rpmOfrecida.toFixed(2)}/mi (mín $${equipment.rpm_min.toFixed(2)}/mi) → ${posicion}, diferencia ${diferencia >= 0 ? '+' : ''}${formatUSD(diferencia)} vs piso`,
    `💡 ${consejo}`,
  ].join('\n');
}

function buildGeneralMarkdown(respuestaGeneral) {
  if (typeof respuestaGeneral !== 'string' || !respuestaGeneral.trim()) {
    return safeFallbackContent();
  }
  return respuestaGeneral.trim();
}

// Cuando no hay lane catalogada ni millas_ida del LLM: pedir aclaración en vez de inventar un piso.
function buildMissingDataMarkdown() {
  return [
    '📊 Necesito más datos para calcular el piso y el objetivo.',
    'Dime origen, destino y millas (o si es "solo ida") — con eso te doy el número exacto.',
  ].join('\n');
}

function safeFallbackContent() {
  return '⚠️ No pude procesar la consulta; reintenta. Para tarifas incluye origen, destino, millas y equipo.';
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

const HISTORY_CAP = 8;

function capHistory(messages, n = HISTORY_CAP) {
  return messages.slice(-n);
}

function buildExtractionPrompt(systemContext, cappedMessages) {
  const conversationHistory = cappedMessages
    .map(m => `${m.role === 'user' ? 'Dispatcher' : 'TruckyAI'}: ${m.content}`)
    .join('\n\n');

  return `${systemContext}

=== CONVERSACIÓN ===
${conversationHistory}

=== INSTRUCCIONES DE EXTRACCIÓN ===
Analiza el ÚLTIMO mensaje del Dispatcher dentro del contexto de la conversación y extrae los datos según el schema. Reglas:
- intent="rate_check" solo si el dispatcher pregunta por una tarifa/ruta específica; en cualquier otro caso usa "general".
- origen/destino: nombres de ciudad tal como los menciona el dispatcher; usa null si no aparecen.
- millas_ida: tu mejor estimación de millas de SOLO IDA (una dirección); null si no puedes estimarla.
- es_redondo: true por defecto; usa false solo si el dispatcher dice explícitamente "solo ida" o "one way".
- equipo: uno de dry_van, reefer, flatbed, step_deck, drayage_20, drayage_40, power_only; usa "unknown" si no se menciona o no coincide.
- tarifa_ofrecida: el monto en dólares que el broker/shipper ofrece; null si no se menciona ninguna cifra.
- respuesta_general: SOLO para intent="general" — tu respuesta directa y completa a la pregunta del dispatcher, en máximo 5 líneas, en español, sin inventar cifras de tarifas o millas que no estén en el contexto.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// COSTCONFIG — Siempre se lee server-side; el costConfig del body es solo
// fallback cuando no existe registro del usuario.
// ─────────────────────────────────────────────────────────────────────────────

const COSTCONFIG_DEFAULTS = { diesel_precio: 5.5, mpg: 6.5, tarifa_objetivo: 3.0 };

async function getCostConfig(base44, userEmail, clientCostConfig) {
  try {
    const registros = await base44.entities.CostConfig.filter({ usuario: userEmail });
    if (registros.length > 0) return registros[0];
  } catch (_error) {
    // si el fetch falla, se sigue con el fallback en vez de romper la respuesta
  }
  if (clientCostConfig && typeof clientCostConfig === 'object' && clientCostConfig.costo_por_milla) {
    return clientCostConfig;
  }
  return COSTCONFIG_DEFAULTS;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDACIÓN DE BODY — Sin esto, ninguna llamada a IA ni a la base de datos.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_REQUEST_CHARS = 20000;

function isValidMessages(messages) {
  return Array.isArray(messages) && messages.length > 0 && messages.every(m =>
    m && typeof m === 'object' && typeof m.role === 'string' && typeof m.content === 'string'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// Flujo: auth → validar body → capHistory → CostConfig server-side →
// InvokeLLM (schema, +1 retry) → rate_check (piso/objetivo/veredicto en código)
// o general (wrap de respuesta_general) → siempre { content: string }.
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  let user;
  try {
    user = await base44.auth.me();
  } catch (_error) {
    return Response.json({ error: 'No autorizado' }, { status: 401 });
  }
  if (!user) {
    return Response.json({ error: 'No autorizado' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch (_error) {
    return Response.json({ error: 'Cuerpo de la petición inválido' }, { status: 400 });
  }

  const { messages, costConfig: clientCostConfig } = body || {};

  if (!isValidMessages(messages)) {
    return Response.json({ error: 'messages debe ser un array no vacío de objetos { role, content } con valores string' }, { status: 400 });
  }
  if (JSON.stringify(messages).length > MAX_REQUEST_CHARS) {
    return Response.json({ error: 'La conversación es demasiado larga' }, { status: 400 });
  }

  try {
    const cappedMessages = capHistory(messages, HISTORY_CAP);
    const costConfig = await getCostConfig(base44, user.email, clientCostConfig);

    let systemContext = BASE_CONTEXT;
    if (costConfig && costConfig.costo_por_milla) {
      systemContext += `\n\nCOSTOS PERSONALIZADOS DEL USUARIO (solo contexto de rentabilidad para respuestas generales; NUNCA se usan para el piso/objetivo de rate_check):
- Diésel: $${costConfig.diesel_precio ?? COSTCONFIG_DEFAULTS.diesel_precio}/gal | MPG: ${costConfig.mpg ?? COSTCONFIG_DEFAULTS.mpg}
- Costo/milla: $${costConfig.costo_por_milla.toFixed(2)} | Break-even: $${costConfig.tarifa_break_even ? costConfig.tarifa_break_even.toFixed(2) : 'N/A'}/mi
- Objetivo: $${costConfig.tarifa_objetivo ?? COSTCONFIG_DEFAULTS.tarifa_objetivo}/mi`;
    }

    const prompt = buildExtractionPrompt(systemContext, cappedMessages);
    const raw = await extractWithRetry(base44, prompt);

    if (!raw) {
      return Response.json({ content: safeFallbackContent() });
    }

    const intent = raw.intent === 'rate_check' ? 'rate_check' : 'general';

    if (intent === 'general') {
      return Response.json({ content: buildGeneralMarkdown(raw.respuesta_general) });
    }

    // intent === 'rate_check'
    const resolved = resolveMiles(raw.origen, raw.destino, raw.millas_ida, raw.es_redondo);

    if (resolved.insufficient) {
      return Response.json({ content: buildMissingDataMarkdown() });
    }

    const equipment = normalizeEquipment(raw.equipo);
    const bucket = getFlatBucket(resolved.miles);
    const surcharge = resolved.portEverglades ? PORT_EVERGLADES_SURCHARGE : 0;
    const floor = computeFloor(resolved.miles, equipment.rpm_min, bucket.min, surcharge);
    const target = computeTarget(resolved.miles, equipment.rpm_target, bucket.max, surcharge);

    const tarifaOfrecida = typeof raw.tarifa_ofrecida === 'number' && isFinite(raw.tarifa_ofrecida) && raw.tarifa_ofrecida > 0
      ? raw.tarifa_ofrecida
      : null;

    const content = buildRateCheckMarkdown({
      origen: raw.origen || null,
      destino: raw.destino || null,
      miles: resolved.miles,
      esRedondo: raw.es_redondo,
      laneLabel: resolved.lane_label,
      source: resolved.source,
      lowConfidence: resolved.low_confidence,
      equipment,
      floor,
      target,
      tarifaOfrecida,
      portEverglades: resolved.portEverglades,
    });

    return Response.json({ content });

  } catch (_error) {
    // Cualquier falla inesperada retorna respuesta segura, nunca 500 con stack trace.
    return Response.json({ content: safeFallbackContent() });
  }
});
