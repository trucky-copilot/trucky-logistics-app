import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

// Carga automática del .env local (desarrollo). Actualizado para re-bundling.
// archivo y el bloque falla silenciosamente — las vars ya vienen del entorno
// de la plataforma. Evita tener que setear GOOGLE_MAPS_API_KEY manualmente.
try {
  // Ahora lee su PROPIO archivo .env aislado, igual que translateChat
  const envText = await Deno.readTextFile(new URL('./.env', import.meta.url));
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*)\s*$/);
    if (m) Deno.env.set(m[1], m[2].trim());
  }
} catch (_) { }

// El dominio puro (datos de tarifas, cálculo de piso/objetivo/veredicto, la
// resolución de equipo y el armado de la respuesta) vive en ./rateEngine.ts
// para poder cubrirlo con `deno test`.
// Acá queda solo lo que necesita I/O: el prompt, la llamada al LLM, la lectura
// de CostConfig y el handler HTTP.
import {
  FREIGHT_KB_VERSION,
  EQUIPMENT_BENCHMARKS,
  DETENTION,
  HOS_LIMITS,
  DEADHEAD_THRESHOLDS,
  buildAccessorialsLine,
  HISTORY_CAP,
  MAX_REQUEST_CHARS,
  resolveEquipment,
  buildEquipmentQuestionMarkdown,
  buildRateCheckMarkdown,
  buildGeneralMarkdown,
  buildMissingDataMarkdown,
  buildAskMilesMarkdown,
  buildSanityCapMarkdown,
  buildOffTopicMarkdown,
  resolveIntent,
  safeFallbackContent,
  capHistory,
  isValidMessages,
  EXTRACTION_SCHEMA,
  resolveTruckPayment,
  resolveDrayageQuote,
  resolveGenericQuote,
  ultimoMensajeDelDispatcher,
  preguntaPorTotalRedondo,
  buildDrayageRoundTripMarkdown,
  filterAccessorialsByTriggers,
  applyCustomAccessorials,
  type Tamano,
  type CalculatedQuote,
} from './rateEngine.ts';
import { getRouteCounts, loadAccessorials } from './rateTable.ts';
import {
  assertNoInventedFigures,
  buildBoundaryFallbackMarkdown,
  buildRateCheckAllowedNumbers,
  buildGeneralIntentAllowedNumbers,
  buildStaticRateCheckNumbers,
  buildAllowedNumbersSet,
  extractNumericTokens,
} from './llmDataBoundary.ts';
import { resolveLocation } from './nameResolution.ts';
import emailTemplates from './plantillas_correo.json' with { type: 'json' };

// chat-idioma-toggle Fase 2 (re-aplicado en la reconciliación con
// reglas-v3-multiestado): `locale` viaja desde el payload hasta cada builder
// de rateEngine.ts y hasta el BASE_CONTEXT/prompt de extracción. Ver Design
// (engram sdd/chat-idioma-toggle/design) y apply-progress para el detalle de
// por qué esta pieza no tiene Deno.test directo (entry.ts no se puede
// importar desde una prueba).
import { MESSAGES, resolveLocale, type Locale } from './messageCatalog.ts';
// Fase 0 (plan de latencia): medición por etapa. Ver perf.ts.
import { createPerfTracker, attachPerf, type PerfTracker } from './perf.ts';

const ROUTE_COUNTS = getRouteCounts();

const EQUIPMENT_LINES = EQUIPMENT_BENCHMARKS
  .map(e => `- ${e.id} (${e.label}): $${e.rpm_target.toFixed(2)}/mi`)
  .join('\n');

// BASE_CONTEXT dejó de ser una const de módulo: depende de `locale`, que es un
// dato de la request (chat-idioma-toggle Fase 2). Se arma por request dentro
// del handler — ver buildAccessorialsLine() en rateEngine.ts y
// MESSAGES[locale].baseContext() en messageCatalog.ts.

// EXTRACTION_SCHEMA — Único InvokeLLM del handler devuelve exactamente esto.
// Vive en rateEngine.ts (objeto puro, sin I/O) para poder cubrirlo con
// `deno test`; ver tests/marketChat.entrySchema.test.ts.
// El código NO confía ciegamente en enum/formato: normaliza defensivamente
// (ver resolveEquipment/resolveDrayageQuote/resolveGenericQuote/
// resolveTruckPayment) por si el LLM se desvía del schema.

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

function buildExtractionPrompt(systemContext, cappedMessages, locale: Locale) {
  const conversationHistory = cappedMessages
    .map(m => {
      let text = `${m.role === 'user' ? 'Dispatcher' : 'TruckyAI'}: ${m.content}`;
      if (m.role === 'assistant' && m.structuredData && m.structuredData.origen && m.structuredData.destino) {
        const tarifaOferta = m.structuredData.calculo && m.structuredData.calculo.tarifaOfrecida != null 
          ? `, Tarifa ofrecida original: ${m.structuredData.calculo.tarifaOfrecida}` 
          : '';
        text += `\n[Metadatos internos ocultos al usuario - Origen original: ${m.structuredData.origen}, Destino original: ${m.structuredData.destino}${tarifaOferta}]`;
      }
      return text;
    })
    .join('\n\n');

  return `${systemContext}

=== CONVERSACIÓN ===
${conversationHistory}

=== INSTRUCCIONES DE EXTRACCIÓN ===
Analiza el ÚLTIMO mensaje del Dispatcher dentro del contexto de la conversación y extrae los datos según el schema. Reglas:
- intent="ask_miles" si el dispatcher explícitamente pide SOLO la distancia o las millas de una ruta (ej. "solo dame las millas", "cuantas millas hay", "millas de x a y"). Si pide esto, NO asumas "rate_check".
- intent="rate_check" si el dispatcher menciona una ruta, un origen/destino, o pide una cotización explícita o implícitamente (ej. "miami a orlando", "tampa dry van"). ¡Asume rate_check siempre que veas ciudades, a menos que solo pida millas! También asume "rate_check" OBLIGATORIAMENTE si el mensaje modifica o pregunta sobre cómo quedaría una cotización previa (ej. "¿y si le sumo hazmat?", "¿cómo quedaría con pre pull?"). INCLUSO si el usuario pregunta por un PROMEDIO nacional (ej. "rate nacional", "national rate", "tarifa nacional", "promedio nacional") o general de un estado/ciudad sin especificar destino (ej. "tarifa nacional dryvan", "promedio en florida", "tampa dry van rate", "wisconsin rate dryvan", "rate promedio de dryvan en NY"), DEBES usar intent="rate_check", extraer el estado o ciudad en el origen, dejando el destino vacío, y heredar preferentemente el equipo usado en consultas previas de tarifas promedio (no de cotizaciones de rutas intermedias) si no lo menciona en este mensaje.
- intent="draft_email" si el dispatcher pide explícitamente redactar, crear, escribir o responder un correo electrónico, email, plantilla o mensaje para un broker/shipper (ej. "hazme un correo", "redacta un email", "necesito que escribas un correo", "ahora para pedir información un correo", "qué correo le mando"). ¡Usa esto siempre que el usuario mencione la palabra correo, email o plantilla!
- intent="off_topic" solo si el mensaje NO tiene relación con freight, dispatch u operación de carriers — por ejemplo: programación, clima, deportes, recetas, política, traducción, chistes, o aritmética sin referencia a freight, consejos personales, u otras industrias.
- intent="general" en cualquier otro caso. ¡NUNCA repitas mensajes de error del historial como "Necesito más datos..."! Tu respuesta_general debe responder a la pregunta, no simular un error del sistema.
- Ante la duda usa "general". Nunca uses "off_topic" si el mensaje menciona algún término de la KB.
- Ejemplos de off_topic: "¿cómo escribo un for loop en Python?" · "¿cómo está el clima en Miami hoy?" · "¿quién ganó el partido de fútbol de ayer?" · "dame una receta de arroz con pollo" · "¿qué opinas de las elecciones?" · "¿cuánto es 15% de 2400?" · "traduce 'hello' al español" · "cuéntame un chiste".
- Ejemplos que SÍ son general aunque suenen genéricos: "¿cuánto está el diésel?" · "¿qué es TWIC?" · "¿qué es un chasis?" · "¿cuánto es 15% de una carga de $2,400?" (tiene referente de freight).
- origen/destino: Extrae la ciudad. REGLA CRÍTICA Y OBLIGATORIA: Adjunta SIEMPRE la abreviatura del estado de 2 letras al final, separada por una coma (ej. "Rincon, GA", "Atlanta, GA", "Tampa, FL"). Si el usuario proporciona un código postal (zip code), MANTENLO en la ciudad extraída antes del estado (ej. "Miami 33186, FL"). Si el usuario omite el estado o lo escribe mal, DEBES inferir el estado correcto y agregarlo. Si el usuario envía un mensaje corto continuando una cotización anterior, copia exactamente origen y destino del historial. REGLA DE TERMINALES: Si el usuario menciona "NS Rossville", extrae EXACTAMENTE "Rossville, TN" (nunca GA). Si menciona "UP", "UP RAIL" o "Union Pacific", DEBES extraer EXACTAMENTE "Dallas UP, TX". Si menciona "O083", extrae "Atlanta O083, GA". Si menciona "BNSF", extrae "Atlanta BNSF, GA". Si menciona "h572", extrae "Chicago h572, IL". Si menciona "mega rail", "garden city", o la palabra "Port" o "Puerto" sola y el otro punto está en Georgia (GA), extrae EXACTAMENTE "Garden City, GA", INCLUSO si el usuario añade la palabra "Savannah" (ej. si dice "Garden City Terminal Savannah", igual extrae "Garden City, GA"). Para terminales de Florida: si menciona "FIT" o "PET" extrae "Fort Lauderdale FIT, FL" o "Fort Lauderdale PET, FL" respectivamente. Para otras terminales de FL ("MIA", "PEV", "POMTOC", "SFCT", "Port Everglades", "M669", "Port Tampa Bay"), mantén el nombre EXACTO de la terminal que el usuario haya escrito junto a la ciudad correcta (ej. si el usuario escribe "PEV" debes extraer "Miami PEV, FL", si escribe "POMTOC" extrae "Miami POMTOC, FL", si escribe "M669" extrae "Tampa M669, FL"). En general, si se menciona una terminal (puerto, NS, rieles), asocia el estado correctamente según el contexto y no lo confundas con otra ciudad del mismo nombre. NO uses la palabra "Unknown". NO incluyas tamaños.
- es_redondo: true por defecto; usa false solo si el dispatcher dice explícitamente "solo ida" o "one way".
- equipo: uno de dry_van, reefer, flatbed, step_deck, drayage, power_only. Si es continuación de cotización, usa el del historial. REGLA DE ORO: Si el usuario menciona EXPLÍCITAMENTE "dryvan", "dry van", "drivan", "reefer", "flatbed", etc., ese equipo tiene PRIORIDAD ABSOLUTA (asigna "dry_van" para "drivan" o "dry van"). NUNCA lo cambies a drayage ni pidas tamaño de contenedor, incluso si el usuario menciona un puerto.
- equipo="drayage": asúmelo SOLO si el dispatcher menciona explícitamente "drayage", "contenedor", "chasis" o tamaños como "20", "40", "45". ¡REGLA CRÍTICA: NUNCA asumas drayage solo por leer la palabra "puerto", "port", "terminal" o el nombre de una terminal (ej. Garden City, NS)! Si el usuario no menciona el equipo explícitamente, devuelve obligatoriamente "unknown" a menos que haya una REGLA ESTRICTA al final del prompt.
- equipo, distinción reefer vs. contenedor: "reefer" es trailer (RPM); un contenedor refrigerado de puerto es "drayage", nunca "reefer".
- tamano: uno de 20, 40, 45, 20_heavy — SOLO si el dispatcher menciona el tamaño (ej. "20 pies", "45", "mia 40") o si hereda de la cotización anterior; de lo contrario usa "unknown".
- tarifa_ofrecida: el monto en dólares que el broker/shipper ofrece. ¡SOLO extráelo si el usuario menciona explícitamente un monto ofrecido en ESTE mensaje! NO heredes tarifas de cotizaciones anteriores a menos que el usuario pregunte explícitamente por ellas (ej. "¿y con la tarifa que te dije?"). Ante la duda o si es una cotización nueva, pon null.
- pago_camion: el RPM (dólares por milla) que el dispatcher dice que le paga al camión, SOLO si lo menciona explícitamente en este mensaje; null si no.
- broker_name: el nombre de la compañía broker. ¡SOLO extráelo si el usuario menciona explícitamente al broker en ESTE mensaje! NO lo heredes de mensajes anteriores. Ante la duda, devuelve "unknown".
- driver_name: el nombre del conductor o chofer. ¡SOLO extráelo si el usuario lo menciona explícitamente en ESTE mensaje! NO lo heredes de mensajes anteriores. Ante la duda, devuelve "unknown".
- accessorial_triggers: lista de cargos accesoriales que el dispatcher menciona o cuyo gatillo describe (p. ej. "hazmat", "pre-pull", "detention", "chassis", "extra stop", "extra top"). ¡ATENCIÓN CON REEFER!: Si el usuario dice "reefer" o "refeer" para cotizar o pedir una ruta (ej. "miami a tampa reefer", "ruta con reefer"), es el EQUIPO del camión, NUNCA un cargo accesorial (NO lo pongas en accessorial_triggers). Pon "reefer" en accessorial_triggers ÚNICAMENTE si el usuario pregunta explícitamente cuánto se cobra o cómo quedaría con el recargo o ADICIONAL de reefer en el semáforo (ej. "¿cuánto quedaría con el reefer?", "súmale el reefer", "cuánto vale el reefer"). Arreglo vacío si no hay ninguno.
- accessorial_query_mode: "price_only" SOLO cuando el usuario pregunta de forma puntual y exclusiva el precio o valor del cargo accesorial (ej: "¿cuánto vale detention?", "cuál es el valor de detention", "how much is detention?"). Si el usuario hace preguntas más amplias, conceptuales o compuestas (ej: "¿qué es detention y cuánto cobro?", "What is detention and how much do I charge?", "cómo funciona y cuánto cuesta", o si hace más de una pregunta), DEBES clasificar intent="general", accessorial_query_mode="none", y responder a TODO de manera completa y natural en respuesta_general.
- respuesta_general: SOLO para intent="general" — tu respuesta directa y completa a la pregunta del dispatcher, en máximo 5 líneas, ${MESSAGES[locale].extraction.languageDirective}, sin inventar cifras de tarifas o millas que no estén en el contexto. REGLA ESTRICTA DE VOCABULARIO: NUNCA menciones palabras como "records", "files", "archivos", "registros", "database" ni "base de datos" (ni frases como "in my records" o "en mis archivos"). Si una ciudad o ubicación no existe o no se puede calcular la distancia, simplemente indica que no se pudo encontrar la ubicación o calcular la ruta e invita a verificar el nombre o proveer un ZIP code. REGLA DE COSTO POR MILLA (CPM): Si el usuario pregunta por su "costo por milla", "el costo por milla", "CPM", "cost per mile" o costos de operación (ej. "¿cuál es el costo por milla?"), responde tomando DIRECTAMENTE el valor configurado en su calculadora. NUNCA listes las tarifas o RPM de mercado de los 7 equipos si pregunta por costo por milla; responde puntual y exclusivamente a lo que pregunta sin añadir datos no solicitados.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// COSTCONFIG — Siempre se lee server-side; el costConfig del body es solo
// fallback cuando no existe registro del usuario.
// ─────────────────────────────────────────────────────────────────────────────

const COSTCONFIG_DEFAULTS = { diesel_precio: 5.5, mpg: 6.5, tarifa_objetivo: 3.0 };

// ─────────────────────────────────────────────────────────────────────────────
// EMPRESA DEL USUARIO — se resuelve server-side desde la cuenta autenticada.
//
// FAIL-CLOSED: si no se puede resolver, devuelve null y el prompt NO incluye el
// bloque de empresa. Nunca un nombre por defecto: es preferible que el chat diga
// que no tiene el dato antes que nombrar una empresa ajena.
// ─────────────────────────────────────────────────────────────────────────────

function extraerEquipoDeTexto(text: string): string | null {
  if (typeof text !== 'string') return null;
  const t = text.toLowerCase();
  if (/\b(flat[\s_-]?bed|flatber|plataforma)\b/.test(t) || t.includes('flatbed') || t.includes('flatber')) {
    return 'flatbed';
  }
  if (/\b(reefer|refeer|refrigerado)\b/.test(t) || t.includes('reefer') || t.includes('refeer')) {
    return 'reefer';
  }
  if (/\b(dry[\s_-]?van|dryvan|drivan)\b/.test(t) || t.includes('dry van') || t.includes('dryvan')) {
    return 'dry_van';
  }
  if (/\bstep[\s_-]?deck\b/.test(t) || t.includes('step deck')) {
    return 'step_deck';
  }
  if (/\bpower[\s_-]?only\b/.test(t) || t.includes('power only')) {
    return 'power_only';
  }
  if (/\b(drayage|contenedor|container|chasis|chassis)\b/.test(t)) {
    return 'drayage';
  }
  if (/\bvan\b/.test(t)) {
    return 'dry_van';
  }
  return null;
}

function esPreguntaTarifaNacional(texto: string): boolean {
  if (typeof texto !== 'string') return false;
  const t = texto.toLowerCase().trim().replace(/[?¿!¡]/g, '').trim();
  if (t === 'nacional' || t === 'national' || t === 'us' || t === 'usa') return true;
  if (/^(y\s+)?(el\s+|a\s+nivel\s+)?nacional$/i.test(t)) return true;
  if (/^(y\s+)?(the\s+)?national$/i.test(t)) return true;
  const tieneTerminoNacional = t.includes('nacional') || t.includes('national') || /\busa?\b/.test(t) || t.includes('pais') || t.includes('país');
  const tieneTerminoTarifa = t.includes('rate') || t.includes('tarifa') || t.includes('promedio') || t.includes('rpm') || t.includes('precio') || t.includes('cuanto') || t.includes('average');
  return tieneTerminoNacional && (tieneTerminoTarifa || t.length < 25);
}

function esConsultaRatePromedio(texto: string): boolean {
  if (typeof texto !== 'string') return false;
  const t = texto.toLowerCase().trim().replace(/[?¿!¡]/g, '').trim();
  if (esPreguntaTarifaNacional(t)) return true;
  if (t.includes('promedio') || t.includes('average')) return true;
  if (t.includes('referencia') || t.includes('reference')) return true;
  if (/\b(rate|tarifa)\b/.test(t) && (t.includes('nacional') || t.includes('national') || t.includes('promedio') || t.includes(' en ') || t.includes(' de '))) return true;
  return false;
}

function extraerEquipoDeConsultaPromedio(messages: any[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const text = (msg?.content || '').toLowerCase();

    // 1. Mensajes previos del asistente que respondieron con una Tarifa de Referencia / Promedio
    if (msg?.role === 'assistant' && (text.includes('tarifa de referencia') || text.includes('reference rate'))) {
      const eq = extraerEquipoDeTexto(text);
      if (eq) return eq;
    }

    // 2. Mensajes previos del usuario que fueron consultas de rate promedio (excluyendo cotizaciones de rutas con " a ")
    if (msg?.role === 'user' && esConsultaRatePromedio(text) && !text.includes(' a ')) {
      const eq = extraerEquipoDeTexto(text);
      if (eq) return eq;
    }
  }
  return null;
}

function extraerEquipoDelHistorial(messages: any[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = (messages[i]?.content || '').toLowerCase();
    const eq = extraerEquipoDeTexto(text);
    if (eq) return eq;
  }
  return null;
}

function extraerAccesorialDeTexto(text: string): string | null {
  if (typeof text !== 'string') return null;
  const t = text.toLowerCase().replace(/[¿¡?!]/g, ' ');
  if (/\b(detention|detteltion|dettention|detetion|detenci[oó]n|detecci[oó]n|waiting\s*time|espera|tiempo\s*de\s*espera)\b/.test(t) || t.includes('detention') || t.includes('detetion') || t.includes('detenci')) {
    return 'detention';
  }
  if (/\b(pre[\s_-]?pull|prepull)\b/.test(t) || t.includes('pre-pull') || t.includes('prepull')) {
    return 'pre-pull';
  }
  if (/\b(hazmat|peligros[oa])\b/.test(t) || t.includes('hazmat')) {
    return 'hazmat';
  }
  if (/\b(chassis|chasis)\b/.test(t)) {
    return 'chassis';
  }
  if (/\b(layover|laiover|layovre)\b/.test(t)) {
    return 'layover';
  }
  if (/\b(tonu)\b/.test(t)) {
    return 'tonu';
  }
  if (/\b(extra\s*stop|extratop|extrasop|parada\s*extra)\b/.test(t)) {
    return 'extra stop';
  }
  if (/\b(storage|almacenaje)\b/.test(t)) {
    return 'storage';
  }
  return null;
}

function extraerAccesorialDelHistorial(messages: any[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = (messages[i]?.content || '').toLowerCase();
    const acc = extraerAccesorialDeTexto(text);
    if (acc) return acc;
  }
  return null;
}

function esConsultaConceptualAccesorial(texto: string): boolean {
  if (typeof texto !== 'string') return false;
  const t = texto.toLowerCase().replace(/[¿¡?!]/g, ' ').trim();

  // Si une dos preguntas: ej. "what is X and how much...", "qué es X y cuánto..."
  if (/\b(what\s+is|qu[eé]\s+es)\b.*\b(and|y)\b.*\b(how\s+much|cu[aá]nto|c[oó]mo|how)\b/i.test(t)) {
    return true;
  }

  // Si pide explicación, funcionamiento o significado
  if (/\b(explain|explica|explicame|expl[íi]came|how\s+does.*work|c[oó]mo\s+funciona|what\s+does.*mean|qu[eé]\s+significa|cu[aá]ndo\s+aplica|when\s+does.*apply)\b/i.test(t)) {
    return true;
  }

  // Si pregunta "What is detention?" o "¿Qué es detention?" DIRECTAMENTE sobre el concepto,
  // SIN incluir palabras de valor monetario (value, price, rate, fee, cost, valor, precio, tarifa, costo)
  const esPreguntaQueEs = /\b(what\s+is|qu[eé]\s+es)\b/i.test(t);
  const mencionaValor = /\b(value|price|rate|fee|cost|valor|precio|tarifa|costo|monto)\b/i.test(t);
  if (esPreguntaQueEs && !mencionaValor) {
    return true;
  }

  return false;
}

function esPreguntaDePrecioOValor(texto: string): boolean {
  if (typeof texto !== 'string') return false;
  const t = texto.toLowerCase().replace(/[¿¡?!]/g, ' ').trim();
  const enMatch = /\b(how\s+much|value|price|rate|fee|cost|charge|charger)\b/i.test(t);
  const esMatch = /\b(cu[aá]nto|cuanto|cu[aá]l|cual|valor|precio|tarifa|monto|cobrar|cobro|cargar|cargo|cuesta|vale|costo)\b/i.test(t);
  return enMatch || esMatch;
}

async function getOrganizationName(base44, userEmail) {
  try {
    const membresias = await base44.entities.OrganizationMember.filter({
      user_email: userEmail,
      active: true,
    });
    const organizationId = membresias?.[0]?.organization_id;
    if (!organizationId) return null;

    const organizaciones = await base44.entities.Organization.filter({ id: organizationId });
    const nombre = organizaciones?.[0]?.name;
    return typeof nombre === 'string' && nombre.trim() ? nombre.trim() : null;
  } catch (_error) {
    // Si la lectura falla, se sigue sin nombre de empresa en vez de romper la
    // respuesta del chat.
    return null;
  }
}


// Lee el registro CRUDO de CostConfig del usuario (o null). Separado de
// getCostConfig para poder reutilizarlo también en la resolución del pago al
// camión (Decisión 9-B) sin duplicar el fetch.
async function fetchCostConfigRecord(base44, userEmail, activeProfileId) {
  try {
    const registros = await base44.entities.CostConfig.filter({ usuario: userEmail });
    if (registros.length > 0) {
      const targetProfileId = activeProfileId || '1';
      const exactMatch = registros.find((r: any) => (r.profile_id || '1') === targetProfileId);
      if (exactMatch) return exactMatch;
      // Do not fallback to registros[0] to maintain profile isolation
    }
  } catch (_error) {
    // si el fetch falla, se sigue sin registro en vez de romper la respuesta
  }
  return null;
}

function getCostConfig(record, clientCostConfig) {
  // Combinar los defaults, luego el del cliente (más fresco en UI), y finalmente
  // lo de la base de datos (p.ej. pago_camion_rpm que solo vive ahí si no se ha guardado en UI)
  // Pero priorizamos que si la BD no tiene costo_por_milla, se use el de la UI.
  const merged = { ...COSTCONFIG_DEFAULTS };
  if (clientCostConfig && typeof clientCostConfig === 'object') {
    Object.assign(merged, clientCostConfig);
  }
  if (record && typeof record === 'object') {
    // Solo sobreescribir con valores no nulos de la BD
    for (const key of Object.keys(record)) {
      if (record[key] != null) {
        merged[key] = record[key];
      }
    }
  }
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGO AL CAMIÓN — Decisión 9-B. Persiste en CostConfig la primera vez que el
// usuario lo declara (resolveTruckPayment.shouldPersist); las siguientes
// veces se reutiliza desde el perfil y esta función no vuelve a escribir.
// ─────────────────────────────────────────────────────────────────────────────
async function persistPagoCamion(base44, userEmail, record, rpm, activeProfileId) {
  try {
    if (record && record.id) {
      await base44.entities.CostConfig.update(record.id, { pago_camion_rpm: rpm });
    } else {
      await base44.entities.CostConfig.create({ 
        usuario: userEmail, 
        pago_camion_rpm: rpm,
        profile_id: activeProfileId || '1'
      });
    }
  } catch (_error) {
    // Si falla el guardado, la respuesta de este turno sigue adelante con el
    // valor recién declarado; simplemente se volverá a preguntar la próxima
    // vez si el guardado no se pudo confirmar.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// Flujo: auth → validar body → capHistory → CostConfig server-side →
// InvokeLLM (schema, +1 retry) → rate_check (piso/objetivo/veredicto en
// código, tabla-primero + cálculo-siempre — reglas-v3-multiestado) o general
// (wrap de respuesta_general) → siempre { content: string }.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchDrivingMiles(
  base44: any,
  origin: string,
  destination: string,
): Promise<number | null> {
  try {

    const normalizeForMap = (loc: string) => {
      if (!loc || typeof loc !== 'string') return '';
      let norm = loc.trim();
      const lower = norm.toLowerCase();
      // Casos de "port" o "puerto" a secas
      if (lower === 'port' || lower === 'puerto' || lower === 'port, fl' || lower === 'puerto, fl') {
        return `Port Everglades, Fort Lauderdale, FL`;
      }
      // Casos críticos de puertos que igual necesitan ciudad para que Maps no falle
      if (lower.includes('mega rail') || lower.includes('garden city') || lower.includes('savannah port')) return `Georgia Ports Authority - Garden City Terminal, Savannah, GA`;
      if (lower.includes('ns rossville')) return `Norfolk Southern - Rossville Intermodal Facility, 2515 Highway 72, Rossville, TN`;
      if (lower.includes('m669') || lower.includes('port tampa bay')) return `Port Tampa Bay, 2999 Guy N Verger Blvd, Tampa, FL 33605`;
      if (lower.includes('fit') && (lower.includes('terminal') || lower.includes('lauderdale'))) return `Florida International Terminal, 4100 McIntosh Rd, Fort Lauderdale, FL 33316`;
      if (lower.includes('pet') || lower.includes('port everglades') || lower.includes('pev')) return `Port Everglades, Fort Lauderdale, FL`;
      if (lower.includes('pomtoc') || lower.includes('sfct') || lower.includes('port miami') || lower.includes('portmiami')) return `Port of Miami, Miami, FL`;
      // Diccionario de Parques Logísticos y Terminales
      if (lower.includes('o083') || (lower.includes('bnsf') && lower.includes('atlanta'))) return `Austell, GA`;
      if (lower === 'up' || lower === 'up rail' || lower === 'up, tx' || lower.includes('union pacific') || (lower.includes('up') && lower.includes('dallas'))) return `Wilmer, TX`;
      if (lower.includes('h572')) return `Elwood, IL`;
      if (lower.includes('wando') || lower.includes('wwt')) return `Mount Pleasant, SC`;
      return norm;
    };

    const normOrigin = normalizeForMap(origin);
    const normDest = normalizeForMap(destination);

    const cacheKey = `${normOrigin.toLowerCase().trim()}|${normDest.toLowerCase().trim()}`;
    try {
      const cached = await base44.entities.MilesCache.filter({ clave: cacheKey });
      if (cached.length > 0) {
        console.log(`[fetchDrivingMiles] Cache hit! ${cacheKey} = ${cached[0].millas} millas`);
        return cached[0].millas;
      }
    } catch (e) {
      console.log(`[fetchDrivingMiles] Error leyendo cache: ${e}`);
    }
    // --- NUEVO: Leer el archivo .env localmente de forma segura ---
    const envGetters = [
      () => Deno.readTextFileSync('./base44/functions/marketChat/.env'),
      () => Deno.readTextFileSync('./.env'),
      () => Deno.readTextFileSync('../.env'),
      () => Deno.readTextFileSync('../../.env'),
    ];
    let envLoaded = false;
    for (const getter of envGetters) {
      try {
        if (typeof Deno !== "undefined" && typeof Deno.readTextFileSync === "function") {
          const envText = getter();
          envText.split('\n').forEach((line: string) => {
            const [key, ...val] = line.split('=');
            if (key && val.length && typeof Deno !== "undefined" && Deno.env) {
                Deno.env.set(key.trim(), val.join('=').trim());
            }
          });
          envLoaded = true;
          break; // Éxito, no seguir probando
        }
      } catch (_) { }
    }
    console.log(`[fetchDrivingMiles] Env loaded manually: ${envLoaded}`);
    // --------------------------------------------------------------

    // Compatibilidad para leer la llave ya sea en Deno o en Node
    const apiKey = (typeof Deno !== 'undefined' && Deno.env?.get ? Deno.env.get("GOOGLE_MAPS_API_KEY") : undefined) 
      || (typeof process !== 'undefined' && process.env?.GOOGLE_MAPS_API_KEY)
      || "AIzaSyAjsTFlMbPi8QYwV6kbHXBGeTOv0ShYRS0";
    console.log(`[fetchDrivingMiles] apiKey exists: ${!!apiKey}`);

    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');

    url.searchParams.set('origins', normOrigin);
    url.searchParams.set('destinations', normDest);
    url.searchParams.set('units', 'imperial');
    if (apiKey) url.searchParams.set('key', apiKey);

    console.log(`[fetchDrivingMiles] Calling GMaps with origins=${normOrigin}, destinations=${normDest}`);

    const res = await fetch(url.toString());
    if (!res.ok) {
      console.log(`[fetchDrivingMiles] HTTP Error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    console.log(`[fetchDrivingMiles] GMaps Root Status: ${data.status}`);
    if (data.error_message) {
      console.log(`[fetchDrivingMiles] GMaps Error Message: ${data.error_message}`);
    }

    const element = data?.rows?.[0]?.elements?.[0];
    console.log(`[fetchDrivingMiles] GMaps Element Status: ${element?.status}`);

    if (element?.status !== 'OK') return null;

    // Extraer exactamente el texto de millas que arroja Google Maps en su UI
    if (element.distance.text) {
      const match = element.distance.text.match(/[\d,.]+/);
      if (match) {
        const millasCalculadas = Math.round(parseFloat(match[0].replace(/,/g, '')));
        try {
          await base44.entities.MilesCache.create({ clave: cacheKey, millas: millasCalculadas });
        } catch (e) {
          console.log(`[fetchDrivingMiles] Error guardando cache: ${e}`);
        }
        return millasCalculadas;
      }
    }

    const millasCalculadasFallback = Math.round(element.distance.value / 1609);
    try {
      await base44.entities.MilesCache.create({ clave: cacheKey, millas: millasCalculadasFallback });
    } catch (e) {
      console.log(`[fetchDrivingMiles] Error guardando cache: ${e}`);
    }
    return millasCalculadasFallback;


  } catch (error) {
    console.log(`[fetchDrivingMiles] Exception: ${error}`);
    return null;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── FASE 3: CACHÉ EN MEMORIA Y MAPEOS ESTÁTICOS ──────────────────────────────
const STATE_NAMES_MAP: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia'
};
const STATE_CODES: Record<string, string> = {};
for (const [k, v] of Object.entries(STATE_NAMES_MAP)) {
  STATE_CODES[v.toLowerCase()] = k;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

let stateMarketDataCache: CacheEntry<any[]> | null = null;
let containerRouteCache: CacheEntry<any[]> | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos de TTL en memoria

async function getCachedStateMarketData(base44: any, perf: PerfTracker): Promise<any[]> {
  const now = Date.now();
  if (stateMarketDataCache && stateMarketDataCache.expiresAt > now) {
    return stateMarketDataCache.data;
  }
  const raw = await perf.time('db.stateMarketData', () => base44.entities.StateMarketData.filter({}));
  const list = (raw && raw.length > 0) ? raw : [];
  stateMarketDataCache = { data: list, expiresAt: now + CACHE_TTL_MS };
  return list;
}

async function getCachedContainerRoutes(base44: any, perf: PerfTracker): Promise<any[]> {
  const now = Date.now();
  if (containerRouteCache && containerRouteCache.expiresAt > now) {
    return containerRouteCache.data;
  }
  try {
    const raw = await perf.time('db.containerRoute', () => base44.entities.ContainerRoute.filter({}));
    const list = (raw && raw.length > 0) ? raw : [];
    containerRouteCache = { data: list, expiresAt: now + CACHE_TTL_MS };
    return list;
  } catch (_err) {
    return [];
  }
}

// El handler recibe el tracker por parámetro (no global) para que requests
// concurrentes en la misma instancia Deno no mezclen sus tiempos.
async function handleMarketChat(req: Request, perf: PerfTracker): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let locale: Locale = 'es';
  try {
    const base44 = createClientFromRequest(req);

    let user;
    try {
      user = await perf.time('auth.me', () => base44.auth.me());
    } catch (_error) {
      return Response.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders });
    }
    if (!user) {
      return Response.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders });
    }

    let body;
    try {
      body = await req.json();
    } catch (_error) {
      return Response.json({ error: 'Cuerpo de la petición inválido' }, { status: 400, headers: corsHeaders });
    }

    const { messages, costConfig: clientCostConfig, locale: rawLocale, activeProfileId } = body || {};
    locale = resolveLocale(rawLocale);

    if (!isValidMessages(messages)) {
      return Response.json({ error: 'messages debe ser un array no vacío de objetos { role, content } con valores string' }, { status: 400, headers: corsHeaders });
    }

    const cappedMessages = capHistory(messages, HISTORY_CAP);

    if (JSON.stringify(cappedMessages).length > MAX_REQUEST_CHARS) {
      return Response.json({ error: 'La conversación es demasiado larga' }, { status: 400, headers: corsHeaders });
    }
    // Fase 3: Paralelizar lecturas iniciales independientes para reducir la latencia total
    const [costConfigRecord, organizationName, rawStateData] = await Promise.all([
      user ? perf.time('db.costConfig', () => fetchCostConfigRecord(base44, user.email, activeProfileId)) : Promise.resolve(null),
      perf.time('db.organizationName', () => getOrganizationName(base44, user.email)),
      getCachedStateMarketData(base44, perf),
    ]);

    // --- AUTO-FIX: Limpiar valores corruptos (como el 1838) del perfil ---
    if (user && costConfigRecord && costConfigRecord.pago_camion_rpm > 100) {
      await perf.time('db.costConfigFix', () => persistPagoCamion(base44, user.email, costConfigRecord, null, activeProfileId));
      costConfigRecord.pago_camion_rpm = null;
    }
    // ----------------------------------------------------------------------

    const costConfig = getCostConfig(costConfigRecord, clientCostConfig);

    let stateMarketData: any[] = [];
    if (rawStateData && rawStateData.length > 0) {
      stateMarketData = rawStateData.map((s: any) => ({
        ...s,
        state_code: s.state_code ? (STATE_CODES[s.state_code.trim().toLowerCase()] || s.state_code.trim().toUpperCase()) : s.state_code
      }));
    }

    let systemContext = MESSAGES[locale].baseContext({
      freightKbVersion: FREIGHT_KB_VERSION,
      equipmentLines: EQUIPMENT_LINES,
      routeCountFl: ROUTE_COUNTS.fl,
      routeCountTx: ROUTE_COUNTS.tx,
      accessorialsLine: buildAccessorialsLine(locale),
      detentionStandard: DETENTION.standard,
      detentionFreeHours: DETENTION.free_hours,
      detentionMin: DETENTION.min,
      detentionMax: DETENTION.max,
      deadheadOkPct: DEADHEAD_THRESHOLDS.ok_pct,
      deadheadConcerningPct: DEADHEAD_THRESHOLDS.concerning_pct,
      deadheadLongMiles: DEADHEAD_THRESHOLDS.long_deadhead_miles,
      deadheadExtraMin: DEADHEAD_THRESHOLDS.extra_rpm_min,
      deadheadExtraMax: DEADHEAD_THRESHOLDS.extra_rpm_max,
      hosDrivingHours: HOS_LIMITS.driving_hours,
      hosOnDutyHours: HOS_LIMITS.on_duty_hours,
      hosBreakMinutes: HOS_LIMITS.break_minutes,
      hosBreakAfterHours: HOS_LIMITS.break_after_hours,
      hos8Days: HOS_LIMITS.hours_8_days,
      hos7Days: HOS_LIMITS.hours_7_days,
    });
    if (organizationName) {
      systemContext += `\n\nEMPRESA DEL USUARIO: ${organizationName}`;
    }

    // reglas-v3-multiestado Fase 6: costo_por_milla YA existía en CostConfig
    // (Calculadora) como contexto de rentabilidad; ahora ADEMÁS alimenta la
    // base "owner_operator" del veredicto por perfil (ver más abajo). Los
    // valores que se interpolan acá son exactamente los que entran al
    // conjunto autorizado de la frontera LLM/datos para "general" (Fase 7) —
    // el LLM puede repetirlos porque son dato real mostrado, no inventado.
    // Google Maps: si hay origen y destino pero no millas → calculamos automático
    let costConfigValuesShown: Array<number | null | undefined> = [];
    let costoPorMillaPropio: number | null = null;

    // Parseamos explícitamente porque desde el frontend a veces llega como string "3.38"
    const parsedCpm = costConfig?.costo_por_milla != null ? Number(costConfig.costo_por_milla) : NaN;

    // REGLA CORREGIDA: el registro debe existir Y tener costo_por_milla configurado.
    // Un registro vacío (creado en onboarding con solo defaults) NO cuenta como configurado.
    const isCalculatorConfigured = costConfigRecord != null && costConfigRecord.costo_por_milla != null;
    console.log(`[DEBUG] user=${user.email} | costo_por_milla=${costConfigRecord?.costo_por_milla} | isCalculatorConfigured=${isCalculatorConfigured}`);


    if (costConfig && !isNaN(parsedCpm)) {
      costoPorMillaPropio = parsedCpm;
      const diesel = costConfig.diesel_precio != null ? Number(costConfig.diesel_precio) : COSTCONFIG_DEFAULTS.diesel_precio;
      const mpg = costConfig.mpg != null ? Number(costConfig.mpg) : COSTCONFIG_DEFAULTS.mpg;
      const objetivo = costConfig.tarifa_objetivo != null ? Number(costConfig.tarifa_objetivo) : COSTCONFIG_DEFAULTS.tarifa_objetivo;
      const breakEven = costConfig.tarifa_break_even != null ? Number(costConfig.tarifa_break_even) : null;

      costConfigValuesShown = [diesel, mpg, parsedCpm, breakEven, objetivo];
      systemContext += `\n\nDATOS DE LA CALCULADORA DEL USUARIO (Costos propios del carrier):
- Costo por milla propio (CPM): $${parsedCpm.toFixed(2)}/mi
- Tarifa break-even: $${breakEven ? `$${breakEven.toFixed(2)}/mi` : 'N/A'}
- Tarifa objetivo propia: $${objetivo}/mi
- Diésel: $${diesel}/gal | MPG: ${mpg}
REGLA CRÍTICA: Si el usuario pregunta cuál es el costo por milla, CPM o costo de operación, responde usando DIRECTAMENTE su costo por milla de la calculadora ($${parsedCpm.toFixed(2)}/mi). NO confundas "costo por milla" con las tarifas o RPM de venta de mercado de los equipos, y responde únicamente lo que pregunta.`;
    }


    let marketText = "\n\nDATOS DE MERCADO ACTUALES (Promedios RPM base, usa estos valores si preguntan genéricamente):\n";
    
    // Agregamos los accesoriales por defecto de FL para preguntas generales
    const defaultAccFL = loadAccessorials('FL');
    systemContext += `\n\nCARGOS ACCESORIALES ESTÁNDAR (Base de datos): \nFlorida: ${defaultAccFL.map(a => `${a.concepto}: ${a.monto}`).join(' | ')}`;

    if (costConfigRecord && costConfigRecord.custom_accessorials_active && costConfigRecord.custom_accessorials_text) {
      systemContext += `\n\nCARGOS ACCESORIALES PERSONALIZADOS DEL USUARIO (si el usuario te pregunta por el valor de un cargo, responde usando ESTOS datos prioritariamente):\n${costConfigRecord.custom_accessorials_text}`;
    }

    const prompt = buildExtractionPrompt(systemContext, cappedMessages, locale);
    const raw = await perf.time('llm.extract', () => extractWithRetry(base44, prompt));

    if (!raw) {
      return Response.json({ content: safeFallbackContent(locale) });
    }

    let intent = resolveIntent(raw.intent, cappedMessages);

    // INTERCEPTOR: Si el usuario no ha configurado sus costos en la calculadora (ha dejado
    // los valores predeterminados y no tiene costo por milla) y NO es una consulta de millas,
    // bloqueamos el chat y le devolvemos el mensaje indicándole que lo haga.
    if (intent !== 'ask_miles' && !isCalculatorConfigured) {
      return Response.json({ content: MESSAGES[locale].missingCostConfig.content });
    }
    
    // --- Validación determinista de presencia ---
    // Si la IA extrajo un número que no está en el mensaje del usuario (o en el historial reciente para heredados), lo descartamos.
    const ultimoMsg = ultimoMensajeDelDispatcher(cappedMessages);
    const msgSinComas = ultimoMsg.replace(/,/g, '');
    const historialCompletoSinComas = cappedMessages.map(m => m.content).join(' ').replace(/,/g, '');

    if (raw.pago_camion != null && !historialCompletoSinComas.includes(raw.pago_camion.toString())) {
      raw.pago_camion = null;
    }
    // Solo preservar la tarifa ofrecida si el usuario la MENCIONÓ EXPLÍCITAMENTE en este ÚLTIMO mensaje.
    // Esto asegura que si el usuario añade un accesorial ("add pre pull") sin repetir la tarifa,
    // se le muestre la tarjeta con los 3 escenarios (tarjeta de veredicto) en lugar de un solo semáforo.
    if (raw.tarifa_ofrecida != null && !msgSinComas.includes(raw.tarifa_ofrecida.toString())) {
      raw.tarifa_ofrecida = null;
    }

    // INTERCEPTOR EXPLICITO: Si el usuario pide "semáforo", forzamos anular la oferta
    // para que la interfaz renderice los 3 escenarios generales en lugar de evaluar una oferta puntual.
    if (ultimoMsg.toLowerCase().includes('semaforo') || ultimoMsg.toLowerCase().includes('semáforo')) {
      raw.tarifa_ofrecida = null;
    }


    if (raw.millas_ida != null && !msgSinComas.includes(raw.millas_ida.toString())) {
      raw.millas_ida = null; // Descarta las millas inventadas por la IA para que entre Google Maps
    }

    // Si el usuario solo pide millas, omitimos las validaciones de equipo y respondemos de inmediato.
    if (intent === 'ask_miles') {
      if (!raw.millas_ida && raw.origen && raw.destino) {
        raw.millas_ida = await perf.time('maps.miles', () => fetchDrivingMiles(base44, raw.origen, raw.destino));
      }
      
      const permitidasMiles = new Set<number>();
      let responseText = '';
      if (raw.millas_ida != null) {
        responseText = locale === 'en'
          ? `📍 **From ${raw.origen} to ${raw.destino}**\nDistance: approximately **${raw.millas_ida} miles**.`
          : `📍 **De ${raw.origen} a ${raw.destino}**\nDistancia: **${raw.millas_ida} millas** aproximadamente.`;
        permitidasMiles.add(raw.millas_ida);
      } else {
        responseText = locale === 'en'
          ? `I couldn't calculate the miles for that route. Please verify the city names or provide a valid ZIP code.`
          : `No pude calcular las millas para esa ruta. Por favor, verifica las ciudades o incluye el código postal.`;
      }
      
      const conFronteraVerificada = (texto: string, permitidas: Set<number>): string => {
        const userNumbers = extractNumericTokens(ultimoMensajeDelDispatcher(cappedMessages));
        for (const n of userNumbers) permitidas.add(n);
        const chequeo = assertNoInventedFigures(texto, permitidas);
        return chequeo.ok ? texto : buildBoundaryFallbackMarkdown(locale);
      };
      
      return Response.json({ content: conFronteraVerificada(responseText, permitidasMiles) });
    }

    // ── CONSULTA PURA DE ACCESORIAL ────────────────────────────────────────────
    // Si el usuario pregunta el precio de un accesorial (pre-pull, hazmat, etc.)
    // SIN mencionar una ruta específica → responde solo con el valor en texto.
    // Si menciona una ruta + accesorial → deja que fluya al rate_check normal
    // para que aparezca la tarjeta con el total sumado.
    // ── CONSULTA DE ACCESORIAL ────────────────────────────────────────────────
    let triggers = Array.isArray(raw.accessorial_triggers) ? [...raw.accessorial_triggers] : [];

    // Detectar si el usuario está preguntando por el valor o si es conceptual
    const esPreguntaPrecio = esPreguntaDePrecioOValor(ultimoMsg);
    const esConceptual = esConsultaConceptualAccesorial(ultimoMsg);

    // Si el mensaje actual menciona explícitamente algún accesorial en el texto (ej. "detetion", "prepull"),
    // asegurar que esté en triggers
    const accesorialEnTexto = extraerAccesorialDeTexto(ultimoMsg);
    if (accesorialEnTexto && !triggers.includes(accesorialEnTexto)) {
      triggers.push(accesorialEnTexto);
    }

    // Si no tiene triggers pero es una consulta de precio o conceptual sobre accesoriales
    // y no hay ruta de transporte específica (sin origen ni destino), hereda del historial:
    if (triggers.length === 0 && (esPreguntaPrecio || esConceptual) && !raw.origen && !raw.destino) {
      const inheritedAcc = extraerAccesorialDelHistorial(cappedMessages);
      if (inheritedAcc) {
        triggers.push(inheritedAcc);
      }
    }

    // Si hay accesoriales identificados y no es una cotización de ruta:
    if (triggers.length > 0 && !raw.origen && !raw.destino && intent !== 'rate_check') {
      if (esConceptual) {
        // El usuario hizo una pregunta de definición o compuesta (ej: "¿Qué es detention y cuánto cobro?")
        // -> Debe responder de manera general en texto respondiendo a todo.
        intent = 'general';
        raw.accessorial_query_mode = 'none';
      } else if (esPreguntaPrecio || raw.accessorial_query_mode === 'price_only' || triggers.length > 0) {
        // El usuario pregunta puntualmente el valor, cuánto cobrar, o nombra el accesorial a secas
        // -> Debe mostrar la plantilla limpia.
        raw.accessorial_query_mode = 'price_only';
      }
    }

    const accessorialMode = typeof raw.accessorial_query_mode === 'string'
      ? raw.accessorial_query_mode
      : 'none';

    console.log(`[DEBUG accesorial] triggers=${JSON.stringify(triggers)} | mode=${accessorialMode} | intent=${intent} | conceptual=${esConceptual} | precio=${esPreguntaPrecio}`);

    const esConsultaPuraAccesorial = triggers.length > 0 && accessorialMode === 'price_only' && !esConceptual;

    if (esConsultaPuraAccesorial) {
      const itemsFL = loadAccessorials('FL' as any);
      const customAccessorialsText = costConfigRecord?.custom_accessorials_active ? costConfigRecord.custom_accessorials_text : null;
      
      const mergedItems = customAccessorialsText ? applyCustomAccessorials(itemsFL, customAccessorialsText) : itemsFL;
      const matchedItems = filterAccessorialsByTriggers(mergedItems, triggers);

      const lineas: string[] = [];
      if (locale === 'en') {
        lineas.push(`💰 **Accessorial fees for: ${triggers.join(', ')}**\n`);
      } else {
        lineas.push(`💰 **Cargos accesoriales para: ${triggers.join(', ')}**\n`);
      }

      if (matchedItems.length > 0) {
        const uniqueItems: typeof matchedItems = [];
        const seen = new Set<string>();
        for (const a of matchedItems) {
          const key = `${a.concepto}|${a.monto}`;
          if (!seen.has(key)) {
            seen.add(key);
            uniqueItems.push(a);
          }
        }
        
        for (const a of uniqueItems) {
          const customFlag = a.isCustom 
            ? (locale === 'en' ? " *(Custom)*" : " *(Personalizado)*") 
            : "";
          let montoTexto = a.monto;
          if (locale === 'en') {
            montoTexto = montoTexto
              .replace(/·\s*por hora/gi, '· per hour')
              .replace(/·\s*por contenedor/gi, '· per container')
              .replace(/·\s*por d[ií]a/gi, '· per day');
          }
          lineas.push(`- ${a.concepto}${customFlag}: **${montoTexto}**`);
        }
      } else {
        if (locale === 'en') {
          lineas.push(`I don't have a standard rate for that accessorial fee.`);
          lineas.push(`I recommend confirming the amount directly with your broker.`);
        } else {
          lineas.push(`No tengo una tarifa estándar registrada para ese cargo.`);
          lineas.push(`Te recomiendo confirmar el monto con tu broker directamente.`);
        }
      }

      return Response.json({ content: lineas.join('\n') });
    }


    console.log(`[entry] Extracted: intent=${intent}, origen=${raw.origen}, destino=${raw.destino}, millas=${raw.millas_ida}`);

    const esPreguntaNacional = esPreguntaTarifaNacional(ultimoMsg);
    const esConsultaPromedio = esConsultaRatePromedio(ultimoMsg);

    if (esPreguntaNacional) {
      intent = 'rate_check';
      raw.origen = null;
      raw.destino = 'US';
      raw.millas_ida = null;
    } else if (raw.origen && raw.destino && raw.origen.toLowerCase().trim() === raw.destino.toLowerCase().trim()) {
      raw.destino = null;
      raw.millas_ida = null;
    }

    const equipoEnUltimoMensaje = extraerEquipoDeTexto(ultimoMsg);
    if (equipoEnUltimoMensaje) {
      raw.equipo = equipoEnUltimoMensaje;
    } else if (esConsultaPromedio) {
      // En consultas sobre rates promedios o nacionales sin equipo explícito,
      // heredamos preferentemente el equipo de la consulta previa sobre rates promedios (no de las rutas)
      const equipoConsultaPromedio = extraerEquipoDeConsultaPromedio(cappedMessages);
      if (equipoConsultaPromedio) {
        raw.equipo = equipoConsultaPromedio;
      } else if (!raw.equipo || raw.equipo === 'unknown') {
        const inherited = extraerEquipoDelHistorial(cappedMessages);
        if (inherited) raw.equipo = inherited;
      }
    } else if (!raw.equipo || raw.equipo === 'unknown') {
      const inheritedEquipment = extraerEquipoDelHistorial(cappedMessages);
      if (inheritedEquipment) {
        raw.equipo = inheritedEquipment;
      }
    }

    // Normalizar texto por si el LLM extrajo "Dry Van" en lugar de "dry_van"
    if (raw.equipo) {
      raw.equipo = raw.equipo.toLowerCase().replace(' ', '_');
    }


    // --------------------------------------------------- 

    // Google Maps: si hay origen y destino pero no millas → calculamos automático.
    // Va aquí porque necesita que `raw` e `intent` ya estén declarados.
    // Usamos !raw.millas_ida para cubrir null, undefined, y 0 (que a veces el LLM arroja si no sabe).
    if (intent === 'rate_check' && !raw.millas_ida && raw.origen && raw.destino) {
      raw.millas_ida = await perf.time('maps.miles', () => fetchDrivingMiles(base44, raw.origen, raw.destino));
    }

    // reglas-v3-multiestado Fase 7 (criterio 4): validador automático de la
    // frontera LLM/datos. Corre SIEMPRE, para toda respuesta, justo antes de
    // devolverla — no es opcional ni depende del intent. Si aparece una cifra
    // fuera del conjunto autorizado, la respuesta NUNCA sale cruda: se
    // reemplaza por `buildBoundaryFallbackMarkdown()`.
    const conFronteraVerificada = (texto: string, permitidas: Set<number>): string => {
      // Los números tipeados por el usuario en el turno actual o mensajes recientes siempre están autorizados.
      for (const m of cappedMessages) {
        if (m.role === 'user' && m.content) {
          const userNumbers = extractNumericTokens(m.content);
          for (const n of userNumbers) permitidas.add(n);
        }
      }
      
      const chequeo = assertNoInventedFigures(texto, permitidas);
      return chequeo.ok ? texto : buildBoundaryFallbackMarkdown(locale);
    };

    if (intent === 'off_topic') {
      // Sin cifras por diseño (buildOffTopicMarkdown) — igual pasa por la
      // frontera para que ningún camino de respuesta quede sin verificar.
      return Response.json({ content: conFronteraVerificada(buildOffTopicMarkdown(locale), new Set()) });
    }

    if (intent === 'general') {
      const permitidasGeneral = buildGeneralIntentAllowedNumbers(costConfigValuesShown);
      return Response.json({ content: conFronteraVerificada(buildGeneralMarkdown(raw.respuesta_general, locale), permitidasGeneral) });
    }

    if (intent === 'draft_email') {
      const formattedTemplates = emailTemplates.templates.map(t => 
        `Plantilla ID: ${t.id}\nNombre: ${t.name}\nCuándo usarla: ${t.description}\nCuerpo exacto a copiar:\n${t.body}\n-----------------------------------\n`
      ).join('');

      let organizationName = 'Desconocido';
      let carrierProfile = null;
      let brokers: any[] = [];
      let drivers: any[] = [];
      let debugOrgId = '';
      let debugProfilesLength = 0;
      let debugAllBrokersLength = 0;

      try {
        const memberships = await perf.time('db.draftContext', () => base44.entities.OrganizationMember.filter({ user_email: user.email, active: true }));
        if (memberships && memberships.length > 0) {
          const orgId = memberships[0].organization_id;
          debugOrgId = orgId;
          
          try {
             const org = await perf.time('db.draftContext', () => base44.entities.Organization.get(orgId));
             if (org) organizationName = org.name;
          } catch(err) {
             console.error('Error fetching org:', err);
          }
          
          // Fase 3: Paralelizar consultas de draft por organización y eliminar fallbacks inseguros a toda la BD
          const [profiles, allBrokers, allDrivers] = await Promise.all([
            perf.time('db.draftProfiles', () => base44.entities.CarrierProfile.filter({ organization_id: orgId })),
            perf.time('db.draftBrokers', () => base44.entities.Broker.filter({ organization_id: orgId })),
            perf.time('db.draftDrivers', () => base44.entities.Driver.filter({ organization_id: orgId })),
          ]);

          debugProfilesLength = profiles ? profiles.length : 0;
          if (profiles && profiles.length > 0) {
            carrierProfile = profiles[0];
          }

          debugAllBrokersLength = allBrokers ? allBrokers.length : 0;
          const targetProfId = activeProfileId || '1';
          brokers = (allBrokers || []).filter((b: any) => (b.profile_id || '1') === targetProfId);
          drivers = (allDrivers || []).filter((d: any) => (d.profile_id || '1') === targetProfId);
        }
      } catch(e) {
         console.error('[draft_email] Error fetching organization info:', e);
      }

      let brokerInfoText = '';
      let rawBroker = (raw.broker_name && raw.broker_name !== 'unknown') ? raw.broker_name : null;
      if (rawBroker) {
         const found = brokers.find(b => b.nombre.toLowerCase().includes(rawBroker.toLowerCase()));
         if (found) {
             brokerInfoText = JSON.stringify({ nombre: found.nombre, mc: found.mc_number });
         } else {
             brokerInfoText = JSON.stringify({ nombre: rawBroker, mc: '' });
         }
      } else {
         // Si el usuario no especificó el broker explícitamente, siempre usa Team
         brokerInfoText = JSON.stringify({ nombre: 'Team', mc: '' });
      }

      let driverInfoText = '';
      let rawDriver = (raw.driver_name && raw.driver_name !== 'unknown') ? raw.driver_name : null;
      if (rawDriver) {
         const foundD = drivers.find(d => (d.nombre + ' ' + (d.apellido||'')).toLowerCase().includes(rawDriver.toLowerCase()));
         if (foundD) {
             driverInfoText = JSON.stringify({ nombre: foundD.nombre + ' ' + (foundD.apellido || ''), telefono: foundD.telefono });
         } else {
             driverInfoText = `Conductor "${rawDriver}" no encontrado en DB. Pon su nombre pero deja el teléfono como [Phone]. NUNCA inventes números.`;
         }
      } else {
         // Si el usuario no especificó conductor explícitamente, no lo adivines.
         driverInfoText = 'No se proporcionó conductor explícitamente. Deja el espacio en blanco o pon [Phone]. NUNCA inventes números.';
      }

      let myCompany = carrierProfile?.company_name || organizationName || 'Desconocido';
      let myMC = carrierProfile?.mc_number;
      let myDOT = carrierProfile?.dot_number;
      
      // Si el usuario puso su MC en el campo de "Nombre de la empresa" durante el registro
      if (!myMC && myCompany.toUpperCase().startsWith('MC')) {
         myMC = myCompany;
      }
      
      if (myMC) {
         // Mantener solo los números para que no se duplique el prefijo "MC"
         myMC = myMC.replace(/\D/g, '');
      }

      const ultimoCalculoMsg = cappedMessages.slice().reverse().find(m => m.structuredData && m.structuredData.calculo);
      const ultimoPiso = ultimoCalculoMsg?.structuredData?.calculo?.piso;
      const pisoStr = ultimoPiso != null ? `$${ultimoPiso}` : 'No detectado';

      const draftingPrompt = `Eres Trucky, asistente de Dispatch. El usuario te ha pedido redactar o responder un correo.
Usa EXACTAMENTE alguna de las siguientes plantillas para generar tu respuesta:

${formattedTemplates}

Información específica del contexto extraída de la base de datos para este correo:
- Tu nombre de Dispatcher y correo: ${user.email} (Úsalo para la firma donde dice [email]).
- Nombre de tu empresa (Carrier): ${myCompany}
- MC de tu empresa: ${myMC || '(Configura tu Carrier Profile)'}
- DOT de tu empresa: ${myDOT || 'NO_DISPONIBLE'}
- Broker detectado: ${brokerInfoText}
- Conductor detectado: ${driverInfoText}
- Ruta mencionada: ${raw.origen || 'No detectado'} a ${raw.destino || 'No detectado'}
- Equipo: ${raw.equipo !== 'unknown' ? raw.equipo : 'No detectado'}
- Tarifa ofrecida en la discusión: ${raw.tarifa_ofrecida || 'No detectada'}
- Piso o tarifa mínima requerida (calculado previamente): ${pisoStr}

Instrucciones:
1. Elige la plantilla que mejor se adapte a la intención del usuario.
2. Los correos SIEMPRE tienen que ser en inglés.
3. Rellena los campos de la firma ([Your name], [Company], [MC], [DOT], [phone], [email]) con los datos de tu empresa y usuario provistos arriba. Si dice "NO_DISPONIBLE", "(Configura tu Carrier Profile)" o "[DOT]", DEJA LOS CORCHETES tal cual en el correo. NUNCA inventes números.
4. Rellena [Broker name] con el nombre del broker. ¡REGLA CRÍTICA!: Si el campo "Broker detectado" empieza con "MULTIPLE_BROKERS:", ENTONCES NO REDACTES NINGÚN CORREO. Devuelve ÚNICAMENTE la pregunta que se te indica allí (en español) para que el usuario elija. Si el broker es "Team", pon "Team" y elimina la línea del MC del broker en el correo si la plantilla la tiene.
5. ¡REGLA CRÍTICA PARA CONDUCTOR!: Si el campo "Conductor detectado" empieza con "MULTIPLE_DRIVERS:", ENTONCES NO REDACTES NINGÚN CORREO. Devuelve ÚNICAMENTE la pregunta que se te indica allí.
6. ¡REGLA CRÍTICA PARA TARIFA!: Si el usuario te pide cotizar pero NO especifica un número exacto en su mensaje, simplemente mantén el espacio de la tarifa entre corchetes (ej. $[offered] o $[rate]) en el correo para que el usuario lo llene manualmente después. NO interrumpas el flujo para preguntarle.
7. ¡REGLA CRÍTICA DE REDACCIÓN!: ESTÁ ESTRICTAMENTE PROHIBIDO redactar tu propio correo. DEBES COPIAR Y PEGAR el 'Cuerpo exacto a copiar' de la plantilla palabra por palabra, reemplazando ÚNICAMENTE los campos entre corchetes [...]. No agregues ni quites oraciones. 
8. ¡REGLAS PARA LLENAR LOS CAMPOS (ADAPTABILIDAD AL TIPO DE CARGA)!:
   - [Broker name]: Usa EXACTAMENTE el valor de "nombre" que viene en el JSON del "Broker detectado". NO uses "Team" a menos que el nombre sea literalmente "Team".
   - [Empty Return: ...]: Si el equipo es OTR (dry van, reefer, flatbed), ELIMINA COMPLETAMENTE ESTA LÍNEA DEL CORREO (no dejes espacios en blanco ni pongas N/A). Solo aplica y se llena si es drayage (puerto).
   - [Includes]: Si es dry van, pon "LH + FSC". Si es reefer, pon "LH + FSC + genset". Si es flatbed, pon "LH + FSC + tarps". Si es drayage (puerto/contenedor), pon "LH + FSC + Chassis".
   - MC#: [MC] (el que está en la mitad del correo): Llena este con el MC del BROKER (sácalo del JSON "Broker detectado").
   - [phone]: Reemplázalo EXACTAMENTE con el valor de "telefono" del JSON "Conductor detectado". Si no hay datos, está vacío, o dice "No se proporcionó...", déjalo simplemente como "[Phone]". NUNCA INVENTES UN NÚMERO.
   - MC# [MC] | DOT# [DOT] (el que está en tu firma al final): Llena este con TU MC y DOT de Carrier. Si tu DOT dice "NO_DISPONIBLE", escribe exactamente "[DOT]". NUNCA INVENTES UN NÚMERO (ej. nunca pongas DOT-654321 o similares).
9. ¡REGLA CRÍTICA DE FORMATO!: El correo debe mantener su estructura de párrafos. Utiliza saltos de línea estándar (el carácter "\\n") para separar los párrafos y las líneas de la firma. NO uses entidades HTML como "&#10;" ni "<br>".

Conversación reciente:
${cappedMessages.map(m => m.role + ': ' + m.content).join('\n')}
`;

      const draftResult = await perf.time('llm.draftEmail', () => base44.integrations.Core.InvokeLLM({
        prompt: draftingPrompt,
        response_json_schema: {
          type: "object",
          properties: {
            correo: { type: "string" }
          },
          required: ["correo"]
        }
      }));

      let respuesta = draftResult?.correo || 'Error redactando el correo. Por favor, intenta de nuevo.';
      
      if (!respuesta.includes('¿') && !respuesta.startsWith('\`\`\`')) {
        respuesta = '\`\`\`text\n' + respuesta + '\n\`\`\`';
      }
      
      return Response.json({ content: respuesta });
    }

    // intent === 'rate_check'
    //
    // reglas-v3-multiestado Fase 3: ya NO hay guardarraíl geográfico que
    // rechace antes de calcular — el principio es "nunca se rechaza por falta
    // de tabla". Tampoco hay estimación de millas por IA: solo tabla, dato del
    // usuario, o se pregunta.

    // Pago al camión (Decisión 9-B): se resuelve antes del cálculo porque
    // computeFloorTarget lo usa como piso cuando no hay piso de tabla.

    // --- NUEVO: Validación determinista de presencia ---
    // Si la IA extrajo un número que no está en el mensaje del usuario, lo descartamos.

    // (La validación determinista de presencia se movió arriba, antes de Google Maps)

    const truckPayment = resolveTruckPayment(costConfigRecord, raw.pago_camion);
    if (truckPayment.shouldPersist && truckPayment.rpm != null) {
      await perf.time('db.persistPagoCamion', () => persistPagoCamion(base44, user.email, costConfigRecord, truckPayment.rpm, activeProfileId));
    }

    const tarifaOfrecida = typeof raw.tarifa_ofrecida === 'number' && isFinite(raw.tarifa_ofrecida) && raw.tarifa_ofrecida > 0
      ? raw.tarifa_ofrecida
      : null;

    let content: string;
    let calculo: CalculatedQuote | null = null;
    let rpmPermitido: number | null = null;

    const customAccessorialsText = costConfigRecord?.custom_accessorials_active ? costConfigRecord.custom_accessorials_text : null;

    // Fase 3: ContainerRoute solo se consulta y cachea si el equipo requerido es drayage
    let dynamicContainerRoutes: any[] = [];
    if (raw.equipo === 'drayage') {
      dynamicContainerRoutes = await getCachedContainerRoutes(base44, perf);
    }

    if (raw.equipo === 'drayage') {
      const tamano: Tamano | null = ['20', '40', '45', '20_heavy'].includes(raw.tamano) ? (raw.tamano as Tamano) : null;
      if (!tamano) {
        content = buildEquipmentQuestionMarkdown('size', locale);
      } else {
        const outcome = resolveDrayageQuote({
          origenRaw: raw.origen,
          destinoRaw: raw.destino,
          tamano,
          millasIdaDeclaradas: raw.millas_ida,
          pagoCamionRpm: truckPayment.rpm,
          tarifaOfrecida,
          accessorialTriggers: raw.accessorial_triggers,
          costoPorMillaPropio,
          tarifaObjetivaPropia: costConfig?.tarifa_objetivo != null ? Number(costConfig.tarifa_objetivo) : null,
          tarifaBreakEvenPropia: costConfig?.tarifa_break_even != null ? Number(costConfig.tarifa_break_even) : null,
          rawPrompt: msgSinComas,
          customAccessorialsText,
          dynamicContainerRoutes,
          stateMarketData,
        });
        if (outcome.kind === 'ask_miles') {
          content = raw.destino ? buildAskMilesMarkdown(outcome.ciudadConocida, locale) : buildMissingDataMarkdown(locale);
        } else if (outcome.kind === 'fuera_de_rango') {
          content = buildSanityCapMarkdown(locale);
        } else {
          calculo = outcome.calculo;
          content = buildRateCheckMarkdown(outcome.calculo, locale);
          if (preguntaPorTotalRedondo(ultimoMensajeDelDispatcher(cappedMessages))) {
            content += `\n\n${buildDrayageRoundTripMarkdown(outcome.calculo, locale)}`;
          }
        }
      }
    } else {
      const resolvedEquipment = resolveEquipment(raw.equipo);
      if (resolvedEquipment.status === 'ask') {
        content = buildEquipmentQuestionMarkdown(resolvedEquipment.reason, locale);
      } else {
        const outcome = resolveGenericQuote({
          origenRaw: raw.origen,
          destinoRaw: raw.destino,
          accessorialTriggers: raw.accessorial_triggers,
          equipment: resolvedEquipment.equipment,
          millasIdaDeclaradas: raw.millas_ida,
          pagoCamionRpm: truckPayment.rpm,
          tarifaOfrecida,
          costoPorMillaPropio,
          tarifaObjetivaPropia: costConfig?.tarifa_objetivo != null ? Number(costConfig.tarifa_objetivo) : null,
          tarifaBreakEvenPropia: costConfig?.tarifa_break_even != null ? Number(costConfig.tarifa_break_even) : null,
          stateMarketData,
          customAccessorialsText,
        });
        if (outcome.kind === 'national_rpm_only') {
          rpmPermitido = outcome.rpm;
          const locName = outcome.estadoBusqueda === 'US' 
            ? (locale === 'en' ? 'National' : 'Nacional') 
            : outcome.estadoBusqueda;
          const equipName = outcome.equipmentLabel.replace("53' ", "");
          if (locale === 'en') {
            content = `📍 **Reference Rate (${locName})**\nFor **${equipName}**, the current average rate is **$${outcome.rpm.toFixed(2)} per mile**.`;
          } else {
            content = `📍 **Tarifa de Referencia (${locName})**\nPara el equipo **${equipName}**, la tarifa promedio actual es de **$${outcome.rpm.toFixed(2)} por milla**.`;
          }
        } else if (outcome.kind === 'ask_miles') {
          content = buildMissingDataMarkdown(locale);
        } else if (outcome.kind === 'fuera_de_rango') {
          content = buildSanityCapMarkdown(locale);
        } else {
          calculo = outcome.calculo;
          content = buildRateCheckMarkdown(outcome.calculo, locale);
        }
      }
    }

    const permitidasRateCheck = calculo ? buildRateCheckAllowedNumbers(calculo) : buildAllowedNumbersSet(buildStaticRateCheckNumbers());
    if (rpmPermitido !== null) {
      permitidasRateCheck.add(rpmPermitido);
    }

    // Ya no se inyecta el origen/destino como comentario HTML, ya que el 
    // frontend lo estaba renderizando visiblemente en algunos casos.

    const responsePayload: any = { content: conFronteraVerificada(content, permitidasRateCheck) };
    if (calculo) {
      responsePayload.structuredData = {
        intent: 'rate_check',
        origen: raw.origen || null,
        destino: raw.destino || null,
        calculo: calculo,
        stateMarketData: stateMarketData
      };
    }
    return Response.json(responsePayload, { headers: corsHeaders });

  } catch (error: any) {
    console.error('[entry.ts] Unhandled Exception:', error);
    // Cualquier falla inesperada retorna respuesta segura con cabeceras CORS
    return Response.json({ content: safeFallbackContent(locale), error: error?.message || 'Error del servidor' }, { headers: corsHeaders });
  }
}

// Punto de entrada: un tracker nuevo por request y el resumen se adjunta en
// un solo lugar, en vez de tocar cada `return Response.json(...)` del handler.
Deno.serve(async (req: Request) => {
  const perf = createPerfTracker();
  const response = await handleMarketChat(req, perf);
  return attachPerf(response, perf);
});
