import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

// Carga automática del .env local (desarrollo). En producción no existe el
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
- intent="rate_check" si el dispatcher menciona una ruta, un origen/destino, o pide una cotización explícita o implícitamente (ej. "miami a orlando", "tampa dry van"). ¡Asume rate_check siempre que veas ciudades, a menos que solo pida millas! También asume "rate_check" OBLIGATORIAMENTE si el mensaje modifica o pregunta sobre cómo quedaría una cotización previa (ej. "¿y si le sumo hazmat?", "¿cómo quedaría con pre pull?"). EXCEPCIÓN CRÍTICA: Si el usuario pregunta por un PROMEDIO nacional o general de un estado sin especificar ruta (ej. "tarifa promedio nacional de dryvan", "promedio en florida"), DEBES usar intent="general" y NUNCA "rate_check". ¡ESTO APLICA INCLUSO SI HAY ERRORES ORTOGRÁFICOS EN LAS PALABRAS (ej. "atrifa", "nacionl", "promedo")! Debes ser inteligente y deducir la intención general.
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
- accessorial_triggers: lista de cargos accesoriales que el dispatcher menciona o cuyo gatillo describe (p. ej. "reefer", "hazmat", "pre-pull", "detention", "chassis"); arreglo vacío si no menciona ninguno.
- respuesta_general: SOLO para intent="general" — tu respuesta directa y completa a la pregunta del dispatcher, en máximo 5 líneas, ${MESSAGES[locale].extraction.languageDirective}, sin inventar cifras de tarifas o millas que no estén en el contexto. NO menciones los costos personalizados del usuario (break-even, costo por milla, objetivo) a menos que pregunte explícitamente por ellos o por rentabilidad.`;
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

async function getRegisteredEquipment(base44, userEmail) {
  try {
    const memberships = await base44.entities.OrganizationMember.filter({
      user_email: userEmail,
      active: true,
    });
    const organizationId = memberships?.[0]?.organization_id;
    if (!organizationId) return null;

    // Traemos toda la flota sin límite
    const trucks = await base44.entities.Truck.filter({
      organization_id: organizationId,
      estado: 'disponible',
    });

    if (!trucks || trucks.length === 0) return null;
    return trucks; // Retornamos la lista completa de camiones
  } catch (_error) {
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
      let norm = loc;
      const lower = loc.toLowerCase();
      // Casos críticos de puertos que igual necesitan ciudad para que Maps no falle
      if (lower.includes('mega rail') || lower.includes('garden city') || lower.includes('savannah port')) return `Georgia Ports Authority - Garden City Terminal, Savannah, GA`;
      if (lower.includes('ns rossville')) return `Norfolk Southern - Rossville Intermodal Facility, 2515 Highway 72, Rossville, TN`;
      if (lower.includes('m669') || lower.includes('port tampa bay')) return `Port Tampa Bay, 2999 Guy N Verger Blvd, Tampa, FL 33605`;
      if (lower.includes('fit') && (lower.includes('terminal') || lower.includes('lauderdale'))) return `Florida International Terminal, 4100 McIntosh Rd, Fort Lauderdale, FL 33316`;
      if ((lower.includes('pet') || lower.includes('port everglades') || lower.includes('pev')) && lower.includes('lauderdale')) return `Port Everglades, Fort Lauderdale, FL`;
      if (lower.includes('pomtoc') || lower.includes('sfct')) return `${norm}, Miami`;
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
    const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY") || process.env.GOOGLE_MAPS_API_KEY;
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

  const { messages, costConfig: clientCostConfig, locale: rawLocale, activeProfileId } = body || {};
  // Resuelto ANTES del try/catch externo (L~263) a propósito: si algo dentro
  // de ese bloque revienta, el catch-all (safeFallbackContent) ya tiene un
  // locale seguro en scope — nunca cae en undefined. Payload aditivo: si
  // `locale` no viene, resolveLocale default a 'es'.
  const locale: Locale = resolveLocale(rawLocale);

  if (!isValidMessages(messages)) {
    return Response.json({ error: 'messages debe ser un array no vacío de objetos { role, content } con valores string' }, { status: 400 });
  }
  if (JSON.stringify(messages).length > MAX_REQUEST_CHARS) {
    return Response.json({ error: 'La conversación es demasiado larga' }, { status: 400 });
  }

  try {
    const cappedMessages = capHistory(messages, HISTORY_CAP);
    const costConfigRecord = user
      ? await fetchCostConfigRecord(base44, user.email, activeProfileId)
      : null;

    // --- AUTO-FIX: Limpiar valores corruptos (como el 1838) del perfil ---
    if (user && costConfigRecord && costConfigRecord.pago_camion_rpm > 100) {
      await persistPagoCamion(base44, user.email, costConfigRecord, null, activeProfileId);
      costConfigRecord.pago_camion_rpm = null;
    }
    // ----------------------------------------------------------------------

    const [organizationName, registeredEquipment] = await Promise.all([
      getOrganizationName(base44, user.email),
      getRegisteredEquipment(base44, user.email),
    ]);
    const costConfig = getCostConfig(costConfigRecord, clientCostConfig);
    const defaultEquipment = registeredEquipment;

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
    if (defaultEquipment && defaultEquipment.length > 0) {
      const equipNames = defaultEquipment.map((t: any) => t.equipment_type).filter(Boolean);
      systemContext += `\n\nEQUIPOS REGISTRADOS DEL USUARIO: ${equipNames.join(', ')}.`;
      if (equipNames.length === 1) {
         systemContext += `\nREGLA ESTRICTA: El usuario SOLO tiene un camión tipo "${equipNames[0]}". Si el usuario NO menciona explícitamente "drayage", "contenedor", "chasis" ni un tamaño (20/40/45), DEBES extraer "${equipNames[0]}" como equipo, INCLUSO si menciona un puerto o terminal.`;
      }
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
      systemContext += `\n\nCOSTOS PERSONALIZADOS DEL USUARIO (solo contexto de rentabilidad para respuestas generales, NO los menciones a menos que el usuario pregunte por ellos; el piso de rate_check usa "pago_camion_rpm" cuando la tabla no lo trae — ver Decisión 9-B):
- Diésel: $${diesel}/gal | MPG: ${mpg}
- Costo/milla: $${parsedCpm.toFixed(2)} | Break-even: $${breakEven ? breakEven.toFixed(2) : 'N/A'}/mi
- Objetivo: $${objetivo}/mi`;
    }

    const stateMarketData = await base44.entities.StateMarketData.filter({});
    if (stateMarketData && stateMarketData.length > 0) {
      let marketText = "\n\nDATOS DE MERCADO ACTUALES (Promedios RPM base, usa estos valores si preguntan genéricamente):\n";
      marketText += "- TARIFA NACIONAL (USA): Dry Van $3.12, Flatbed $3.65, Reefer $3.66\n";
      costConfigValuesShown.push(3.12, 3.65, 3.66);
      
      stateMarketData.forEach((s: any) => {
        marketText += `- ${s.state_code}: Dry Van $${s.dry_van || 'N/A'}, Reefer $${s.reefer || 'N/A'}, Flatbed $${s.flatbed || 'N/A'}\n`;
        costConfigValuesShown.push(s.dry_van, s.reefer, s.flatbed);
      });
      systemContext += marketText;
    }

    const prompt = buildExtractionPrompt(systemContext, cappedMessages, locale);
    const raw = await extractWithRetry(base44, prompt);

    if (!raw) {
      return Response.json({ content: safeFallbackContent(locale) });
    }

    const intent = resolveIntent(raw.intent, cappedMessages);

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
    if (raw.tarifa_ofrecida != null && !historialCompletoSinComas.includes(raw.tarifa_ofrecida.toString())) {
      raw.tarifa_ofrecida = null;
    }

    // Prevenir el arrastre ("leak") de precios de rutas anteriores si el usuario ingresó una ruta nueva.
    if (raw.tarifa_ofrecida != null && !msgSinComas.includes(raw.tarifa_ofrecida.toString())) {
       const isRouteQuery = /\b(a|to|de|from|-)\b/i.test(ultimoMsg) || ultimoMsg.trim().split(/\s+/).length > 3;
       if (isRouteQuery) {
          raw.tarifa_ofrecida = null;
       }
    }
    if (raw.pago_camion != null && !msgSinComas.includes(raw.pago_camion.toString())) {
       const isRouteQuery = /\b(a|to|de|from|-)\b/i.test(ultimoMsg) || ultimoMsg.trim().split(/\s+/).length > 3;
       if (isRouteQuery) {
          raw.pago_camion = null;
       }
    }
    if (raw.millas_ida != null && !msgSinComas.includes(raw.millas_ida.toString())) {
      raw.millas_ida = null; // Descarta las millas inventadas por la IA para que entre Google Maps
    }

    // Si el usuario solo pide millas, omitimos las validaciones de equipo y respondemos de inmediato.
    if (intent === 'ask_miles') {
      if (!raw.millas_ida && raw.origen && raw.destino) {
        raw.millas_ida = await fetchDrivingMiles(base44, raw.origen, raw.destino);
      }
      
      const permitidasMiles = new Set<number>();
      let responseText = '';
      if (raw.millas_ida != null) {
        responseText = `📍 **De ${raw.origen} a ${raw.destino}**\nDistancia: **${raw.millas_ida} millas** aproximadamente.`;
        permitidasMiles.add(raw.millas_ida);
      } else {
        responseText = `No pude calcular las millas para esa ruta. Por favor, verifica las ciudades o incluye el estado.`;
      }
      
      const conFronteraVerificada = (texto: string, permitidas: Set<number>): string => {
        const userNumbers = extractNumericTokens(ultimoMensajeDelDispatcher(cappedMessages));
        for (const n of userNumbers) permitidas.add(n);
        const chequeo = assertNoInventedFigures(texto, permitidas);
        return chequeo.ok ? texto : buildBoundaryFallbackMarkdown();
      };
      
      return Response.json({ content: conFronteraVerificada(responseText, permitidasMiles) });
    }

    // ── CONSULTA PURA DE ACCESORIAL ────────────────────────────────────────────
    // Si el usuario pregunta el precio de un accesorial (pre-pull, hazmat, etc.)
    // SIN mencionar una ruta específica → responde solo con el valor en texto.
    // Si menciona una ruta + accesorial → deja que fluya al rate_check normal
    // para que aparezca la tarjeta con el total sumado.
    const triggers = Array.isArray(raw.accessorial_triggers) ? raw.accessorial_triggers : [];

    // La IA decide el modo: 'price_only' → solo precio del accesorial en texto,
    // 'include_in_rate' → calcular tarifa + accesorial y mostrar tarjeta de veredicto.
    // Este campo evita los regex frágiles: la IA interpreta cualquier variante natural del usuario.
    const accessorialMode = typeof raw.accessorial_query_mode === 'string'
      ? raw.accessorial_query_mode
      : 'none';

    console.log(`[DEBUG accesorial] triggers=${JSON.stringify(triggers)} | mode=${accessorialMode} | intent=${intent} | tarifa_ofrecida=${raw.tarifa_ofrecida}`);

    const esConsultaPuraAccesorial = triggers.length > 0 && accessorialMode === 'price_only';

    if (esConsultaPuraAccesorial) {
      const itemsFL = loadAccessorials('FL' as any);
      const customAccessorialsText = costConfigRecord?.custom_accessorials_active ? costConfigRecord.custom_accessorials_text : null;
      
      const mergedItems = customAccessorialsText ? applyCustomAccessorials(itemsFL, customAccessorialsText) : itemsFL;
      const matchedItems = filterAccessorialsByTriggers(mergedItems, triggers);

      const lineas: string[] = [];
      lineas.push(`💰 **Cargos accesoriales para: ${triggers.join(', ')}**\n`);

      if (matchedItems.length > 0) {
        for (const a of matchedItems) {
          const customFlag = a.isCustom ? " *(Personalizado)*" : "";
          lineas.push(`- ${a.concepto}${customFlag}: **${a.monto}**`);
        }
      } else {
        lineas.push(`No tengo una tarifa estándar registrada para ese cargo en mi base de datos.`);
        lineas.push(`Te recomiendo confirmar el monto con tu broker directamente.`);
      }

      return Response.json({ content: lineas.join('\n') });
    }


    console.log(`[entry] Extracted: intent=${intent}, origen=${raw.origen}, destino=${raw.destino}, millas=${raw.millas_ida}`);
    // Guardarraíl: Forzar drayage si la ruta existe en BD y el usuario no especificó equipo explícitamente
        const ultimoMensajeLower = ultimoMensajeDelDispatcher(cappedMessages).toLowerCase();
    
    if (intent === 'rate_check') {
      // Verificamos si mencionó un tipo de equipo explícito ("van", "reefer", etc.)
      const mencionoTipo = ['van', 'reefer', 'flat', 'step', 'power','dryage','drayage','contenedor'].some(e => ultimoMensajeLower.includes(e));
      // Verificamos si mencionó la placa de alguno de sus camiones registrados
      const mencionoPlaca = defaultEquipment ? defaultEquipment.some((t: any) => ultimoMensajeLower.includes(t.placa.toLowerCase())) : false;
      const mencionoEquipoEnUltimoMensaje = mencionoTipo || mencionoPlaca;
      
      const equipoYaResuelto = raw.equipo && raw.equipo !== 'unknown';
      const tenemosEquipo = mencionoEquipoEnUltimoMensaje || equipoYaResuelto;

      // Si mencionó la placa, le asignamos el tipo de equipo de esa placa
      if (mencionoPlaca && !mencionoTipo && defaultEquipment) {
        const camionElegido = defaultEquipment.find((t: any) => ultimoMensajeLower.includes(t.placa.toLowerCase()));
        if (camionElegido && camionElegido.equipment_type) {
          raw.equipo = camionElegido.equipment_type.toLowerCase().replace(' ', '_');
        }
      }

      if (!tenemosEquipo) {
        if (defaultEquipment && defaultEquipment.length > 1) {
          // Tiene MÁS DE 1 equipo y no especificó: La IA pregunta y detiene el flujo
          const listaEquipos = defaultEquipment.map((t: any) => `- ${t.placa} (${t.equipment_type || 'Desconocido'})`).join('\n');
          return Response.json({
            content: `Mira, tenemos estos equipos registrados en tu cuenta:\n${listaEquipos}\n\n¿Cuál de estos equipos deseas usar para esta ruta?`
          });
        } else if (defaultEquipment && defaultEquipment.length === 1) {
          // Tiene EXACTAMENTE 1 equipo: Lo toma automático sin preguntar
          const equipoUnico = defaultEquipment[0].equipment_type || 'unknown';
          raw.equipo = equipoUnico.toLowerCase().replace(' ', '_');
        } else {
          // NO tiene flota registrada: preguntamos qué equipo es.
          return Response.json({
            content: `Para darte un cálculo preciso, ¿qué tipo de camión estás buscando (Dry Van, Reefer, Flatbed, Drayage...)?`
          });
        }
      } else if (raw.equipo) {
        // Normalizar texto por si el LLM extrajo "Dry Van" en lugar de "dry_van"
        raw.equipo = raw.equipo.toLowerCase().replace(' ', '_');
      }
    }


    // --------------------------------------------------- 

    // Google Maps: si hay origen y destino pero no millas → calculamos automático.
    // Va aquí porque necesita que `raw` e `intent` ya estén declarados.
    // Usamos !raw.millas_ida para cubrir null, undefined, y 0 (que a veces el LLM arroja si no sabe).
    if (intent === 'rate_check' && !raw.millas_ida && raw.origen && raw.destino) {
      raw.millas_ida = await fetchDrivingMiles(base44, raw.origen, raw.destino);
    }

    // reglas-v3-multiestado Fase 7 (criterio 4): validador automático de la
    // frontera LLM/datos. Corre SIEMPRE, para toda respuesta, justo antes de
    // devolverla — no es opcional ni depende del intent. Si aparece una cifra
    // fuera del conjunto autorizado, la respuesta NUNCA sale cruda: se
    // reemplaza por `buildBoundaryFallbackMarkdown()`.
    const conFronteraVerificada = (texto: string, permitidas: Set<number>): string => {
      // Los números tipeados por el usuario siempre están autorizados a repetirse.
      const userNumbers = extractNumericTokens(ultimoMsg);
      for (const n of userNumbers) permitidas.add(n);
      
      const chequeo = assertNoInventedFigures(texto, permitidas);
      return chequeo.ok ? texto : buildBoundaryFallbackMarkdown();
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
        const memberships = await base44.entities.OrganizationMember.filter({ user_email: user.email, active: true });
        if (memberships && memberships.length > 0) {
          const orgId = memberships[0].organization_id;
          debugOrgId = orgId;
          
          try {
             const org = await base44.entities.Organization.get(orgId);
             if (org) organizationName = org.name;
          } catch(err) {
             console.error('Error fetching org:', err);
          }
          
          let profiles = await base44.entities.CarrierProfile.filter({ organization_id: orgId });
          if (!profiles || profiles.length === 0) {
            profiles = await base44.entities.CarrierProfile.filter({});
          }
          debugProfilesLength = profiles ? profiles.length : 0;
          if (profiles && profiles.length > 0) {
            carrierProfile = profiles[0];
          }

          let allBrokers = await base44.entities.Broker.filter({ organization_id: orgId });
          if (!allBrokers || allBrokers.length === 0) {
            allBrokers = await base44.entities.Broker.filter({});
          }
          debugAllBrokersLength = allBrokers ? allBrokers.length : 0;
          brokers = allBrokers.filter((b: any) => !b.profile_id || b.profile_id === activeProfileId);
          
          let allDrivers = await base44.entities.Driver.filter({ organization_id: orgId });
          if (!allDrivers || allDrivers.length === 0) {
            allDrivers = await base44.entities.Driver.filter({});
          }
          drivers = allDrivers.filter((d: any) => !d.profile_id || d.profile_id === activeProfileId);
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

      const draftResult = await base44.integrations.Core.InvokeLLM({
        prompt: draftingPrompt,
        response_json_schema: {
          type: "object",
          properties: {
            correo: { type: "string" }
          },
          required: ["correo"]
        }
      });

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
      await persistPagoCamion(base44, user.email, costConfigRecord, truckPayment.rpm, activeProfileId);
    }

    const tarifaOfrecida = typeof raw.tarifa_ofrecida === 'number' && isFinite(raw.tarifa_ofrecida) && raw.tarifa_ofrecida > 0
      ? raw.tarifa_ofrecida
      : null;

    let content: string;
    let calculo: CalculatedQuote | null = null;

    const customAccessorialsText = costConfigRecord?.custom_accessorials_active ? costConfigRecord.custom_accessorials_text : null;

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
          tarifaObjetivaPropia: costConfig.tarifa_objetivo != null ? Number(costConfig.tarifa_objetivo) : null,
          rawPrompt: msgSinComas,
          customAccessorialsText,
        });
        if (outcome.kind === 'ask_miles') {
          content = raw.destino ? buildAskMilesMarkdown(outcome.ciudadConocida, locale) : buildMissingDataMarkdown(locale);
        } else if (outcome.kind === 'fuera_de_rango') {
          content = buildSanityCapMarkdown(locale);
        } else {
          calculo = outcome.calculo;
          content = buildRateCheckMarkdown(outcome.calculo, locale);
          // reglas-v3-multiestado Fase 4 (Decisión 2-A): en drayage la doble
          // lectura NUNCA aparece por defecto — solo si el dispatcher pregunta
          // explícitamente por el total de ida y vuelta.
          if (preguntaPorTotalRedondo(ultimoMensajeDelDispatcher(cappedMessages))) {
            content += `\n\n${buildDrayageRoundTripMarkdown(outcome.calculo, locale)}`;
          }
        }
      }
    } else {
      // Guardarraíl de equipo (TRUCKY-48 parcial): resolveEquipment nunca
      // sustituye un tipo de camión: si no está claro, se pregunta.
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
          tarifaObjetivaPropia: costConfig.tarifa_objetivo != null ? Number(costConfig.tarifa_objetivo) : null,
          stateMarketData,
          customAccessorialsText,
        });
        if (outcome.kind === 'ask_miles') {
          content = buildMissingDataMarkdown(locale);
        } else if (outcome.kind === 'fuera_de_rango') {
          content = buildSanityCapMarkdown(locale);
        } else {
          calculo = outcome.calculo;
          content = buildRateCheckMarkdown(outcome.calculo, locale);
        }
      }
    }

    // El conjunto autorizado de un rate_check es EXACTAMENTE lo que trae el
    // bloque calculado; sin bloque calculado (preguntas de dato faltante,
    // tope de sanidad, pedir equipo/tamaño), esas respuestas son estáticas y
    // no traen ninguna cifra — el conjunto vacío las deja pasar tal cual.
    const permitidasRateCheck = calculo ? buildRateCheckAllowedNumbers(calculo) : buildAllowedNumbersSet(buildStaticRateCheckNumbers());

    // Ya no se inyecta el origen/destino como comentario HTML, ya que el 
    // frontend lo estaba renderizando visiblemente en algunos casos.

    const responsePayload: any = { content: conFronteraVerificada(content, permitidasRateCheck) };
    if (calculo) {
      responsePayload.structuredData = {
        intent: 'rate_check',
        origen: raw.origen || null,
        destino: raw.destino || null,
        calculo: calculo
      };
    }
    return Response.json(responsePayload);

  } catch (error) {
    console.error('[entry.ts] Unhandled Exception:', error);
    // Cualquier falla inesperada retorna respuesta segura, nunca 500 con stack trace.
    return Response.json({ content: safeFallbackContent(locale) });
  }
});
