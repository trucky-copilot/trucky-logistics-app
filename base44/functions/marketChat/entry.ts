import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// El dominio puro (datos de tarifas, cálculo de piso/objetivo/veredicto y armado
// de la respuesta) vive en ./rateEngine.ts para poder cubrirlo con `deno test`.
// Acá queda solo lo que necesita I/O: el prompt, la llamada al LLM, la lectura
// de CostConfig y el handler HTTP.
import {
  FREIGHT_KB_VERSION,
  EQUIPMENT_BENCHMARKS,
  FLAT_MINIMUMS,
  LANES,
  PORT_EVERGLADES_SURCHARGE,
  DETENTION,
  ACCESSORIALS,
  HISTORY_CAP,
  MAX_REQUEST_CHARS,
  resolveMiles,
  normalizeEquipment,
  getFlatBucket,
  computeFloor,
  computeTarget,
  buildRateCheckMarkdown,
  buildGeneralMarkdown,
  buildMissingDataMarkdown,
  safeFallbackContent,
  capHistory,
  isValidMessages,
} from './rateEngine.ts';

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

// Una sola llamada InvokeLLM + un reintento único si falla o si el resultado no
// es un objeto parseable. Si ambos intentos fallan, retorna null y el caller usa
// safeFallbackContent().
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
// PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

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
