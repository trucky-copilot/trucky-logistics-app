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
} catch (_) {}

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
  type Tamano,
  type CalculatedQuote,
} from './rateEngine.ts';
import { getRouteCounts } from './rateTable.ts';
import {
  assertNoInventedFigures,
  buildBoundaryFallbackMarkdown,
  buildRateCheckAllowedNumbers,
  buildGeneralIntentAllowedNumbers,
  buildStaticRateCheckNumbers,
  buildAllowedNumbersSet,
} from './llmDataBoundary.ts';
import { resolveLocation } from './nameResolution.ts';

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
    .map(m => `${m.role === 'user' ? 'Dispatcher' : 'TruckyAI'}: ${m.content}`)
    .join('\n\n');

  return `${systemContext}

=== CONVERSACIÓN ===
${conversationHistory}

=== INSTRUCCIONES DE EXTRACCIÓN ===
Analiza el ÚLTIMO mensaje del Dispatcher dentro del contexto de la conversación y extrae los datos según el schema. Reglas:
- intent="rate_check" si el dispatcher menciona una ruta, un origen/destino, un camión, o pide una cotización explícita o implícitamente (ej. "miami a orlando", "tampa dry van"). ¡Asume rate_check siempre que veas ciudades!
- intent="off_topic" solo si el mensaje NO tiene relación con freight, dispatch u operación de carriers — por ejemplo: programación, clima, deportes, recetas, política, traducción, chistes, o aritmética sin referencia a freight, consejos personales, u otras industrias.
- intent="general" en cualquier otro caso. ¡NUNCA repitas mensajes de error del historial como "Necesito más datos..."! Tu respuesta_general debe responder a la pregunta, no simular un error del sistema.
- Ante la duda usa "general". Nunca uses "off_topic" si el mensaje menciona algún término de la KB.
- Ejemplos de off_topic: "¿cómo escribo un for loop en Python?" · "¿cómo está el clima en Miami hoy?" · "¿quién ganó el partido de fútbol de ayer?" · "dame una receta de arroz con pollo" · "¿qué opinas de las elecciones?" · "¿cuánto es 15% de 2400?" · "traduce 'hello' al español" · "cuéntame un chiste".
- Ejemplos que SÍ son general aunque suenen genéricos: "¿cuánto está el diésel?" · "¿qué es TWIC?" · "¿qué es un chasis?" · "¿cuánto es 15% de una carga de $2,400?" (tiene referente de freight).
- origen/destino: EXTRAE TEXTUALMENTE la ciudad origen y destino. Si el usuario envía un mensaje corto continuando una cotización anterior, DEBES BUSCAR en el historial y COPIAR EXACTAMENTE el mismo origen y el mismo destino. Nunca dejes origen/destino en null si se trata de una continuación. IMPORTANTE: Si el usuario menciona un puerto (ej. "MIA", "PEV", "Mega Rail"), INCLÚYELO EXACTAMENTE como lo escribió junto al nombre de la ciudad (ej. "Florida City PEV"). NUNCA traduzcas siglas como "PEV" a "Port Everglades" ni "MIA" a "Miami". NO incluyas tamaños ni medidas. Siempre que sea posible, AÑADE LA ABREVIATURA DEL ESTADO (ej. "Rincon, GA" o "Tampa, FL") al final del nombre.
- millas_ida: SOLO si el dispatcher las dice explícitamente, en millas de SOLO IDA (una dirección); null si no las dice — nunca estimes.
- es_redondo: true por defecto; usa false solo si el dispatcher dice explícitamente "solo ida" o "one way".
- equipo: uno de dry_van, reefer, flatbed, step_deck, drayage, power_only. Si es continuación de cotización, usa el del historial. IMPORTANTE: Si NO se especifica explícitamente el equipo y la ciudad está en Florida (ej. Miami, Tampa, Cutler Bay, Hollywood, etc.), asume equipo="drayage"; de lo contrario usa "unknown".
- equipo="drayage": si el dispatcher menciona "drayage", "contenedor", o tamaños como "20", "40", "45", usa "drayage" (el tamaño va en "tamano").
- equipo, distinción reefer vs. contenedor: "reefer" es trailer (RPM); un contenedor refrigerado de puerto es "drayage", nunca "reefer".
- tamano: uno de 20, 40, 45, 20_heavy — SOLO si el dispatcher menciona el tamaño (ej. "20 pies", "45", "mia 40") o si hereda de la cotización anterior; de lo contrario usa "unknown".
- tarifa_ofrecida: el monto en dólares que el broker/shipper ofrece; null si no se menciona.
- pago_camion: el RPM (dólares por milla) que el dispatcher dice que le paga al camión, SOLO si lo menciona explícitamente en este mensaje; null si no.
- accessorial_triggers: lista de cargos accesoriales que el dispatcher menciona o cuyo gatillo describe (p. ej. "reefer", "hazmat", "pre-pull", "detention", "chassis"); arreglo vacío si no menciona ninguno.
- respuesta_general: SOLO para intent="general" — tu respuesta directa y completa a la pregunta del dispatcher, en máximo 5 líneas, ${MESSAGES[locale].extraction.languageDirective}, sin inventar cifras de tarifas o millas que no estén en el contexto.`;
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

    const trucks = await base44.entities.Truck.filter(
      {
        organization_id: organizationId,
        estado: 'disponible',
      },
      'created_date',
      1
    );

    const equipment = trucks?.[0]?.equipment_type;
    return equipment || null;
  } catch (_error) {
    return null;
  }
}

// Lee el registro CRUDO de CostConfig del usuario (o null). Separado de
// getCostConfig para poder reutilizarlo también en la resolución del pago al
// camión (Decisión 9-B) sin duplicar el fetch.
async function fetchCostConfigRecord(base44, userEmail) {
  try {
    const registros = await base44.entities.CostConfig.filter({ usuario: userEmail });
    if (registros.length > 0) return registros[0];
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
async function persistPagoCamion(base44, userEmail, record, rpm) {
  try {
    if (record && record.id) {
      await base44.entities.CostConfig.update(record.id, { pago_camion_rpm: rpm });
    } else {
      await base44.entities.CostConfig.create({ usuario: userEmail, pago_camion_rpm: rpm });
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
  origin: string,
  destination: string,
): Promise<number | null> {
  try {
    // --- NUEVO: Leer el archivo .env localmente de forma segura ---
    try {
      const envText = Deno.readTextFileSync('./.env');
      envText.split('\n').forEach(line => {
        const [key, ...val] = line.split('=');
        if (key && val.length) Deno.env.set(key.trim(), val.join('=').trim());
      });
    } catch (_) {
      // Si el archivo .env no existe (ej. en la nube), lo ignora sin fallar
    }
    // --------------------------------------------------------------

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY') || 'AIzaSyAjsTFlMbPi8QYwV6kbHXBGeTOv0ShYRS0';
    if (!apiKey) {
      console.log('[fetchDrivingMiles] ERROR: API key is missing. Check .env loading.');
      return null;
    }

    const estadosComunes = ['illinois', 'il', 'georgia', 'gorgia', 'ga', 'florida', 'fl', 'texas', 'tx', 'south carolina', 'sc', 'north carolina', 'nc', 'alabama', 'al', 'mississippi', 'ms', 'tennessee', 'tn', 'oklahoma', 'ok', 'new mexico', 'nm', 'louisiana', 'la', 'arkansas', 'ar', 'california', 'ca', 'arizona', 'az', 'nevada', 'nv'];
    let estadoDetectado = '';
    const textoCombinado = `${origin} ${destination}`.toLowerCase();
    for (const st of estadosComunes) {
      const re = new RegExp(`\\b${st}\\b`, 'i');
      if (re.test(textoCombinado)) {
        estadoDetectado = st;
        break;
      }
    }
    
    // Regla genérica solicitada: si dice Chicago y no detectamos estado, asumimos IL
    if (!estadoDetectado && textoCombinado.includes('chicago')) {
      estadoDetectado = 'il';
    }

    const normalizeForMap = (loc: string) => {
      let norm = loc;
      const lower = loc.toLowerCase();
      // Si el usuario da la pista del estado en uno, se lo prestamos al otro
      if (estadoDetectado && !new RegExp(`\\b${estadoDetectado}\\b`, 'i').test(lower)) {
        norm = `${loc}, ${estadoDetectado.toUpperCase()}`;
      }
      // Casos críticos de puertos que igual necesitan ciudad para que Maps no falle
      if (lower.includes('mega rail') || lower.includes('garden city')) return `${norm}, Savannah`;
      if (lower.includes('pomtoc') || lower.includes('sfct')) return `${norm}, Miami`;
      // Diccionario de Parques Logísticos y Terminales
      if (lower.includes('h572')) return `Elwood, IL`;
      return norm;
    };

    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    const normOrigin = normalizeForMap(origin);
    const normDest = normalizeForMap(destination);
    url.searchParams.set('origins', normOrigin);
    url.searchParams.set('destinations', normDest);
    url.searchParams.set('units', 'imperial');
    url.searchParams.set('key', apiKey);

    console.log(`[fetchDrivingMiles] Calling GMaps with origins=${normOrigin}, destinations=${normDest}`);

    const res = await fetch(url.toString());
    if (!res.ok) {
      console.log(`[fetchDrivingMiles] HTTP Error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const element = data?.rows?.[0]?.elements?.[0];
    console.log(`[fetchDrivingMiles] GMaps Status: ${element?.status}`);
    
    if (element?.status !== 'OK') return null;

        // Extraer exactamente el texto de millas que arroja Google Maps en su UI
    if (element.distance.text) {
      const match = element.distance.text.match(/[\d,.]+/);
      if (match) {
        return Math.round(parseFloat(match[0].replace(/,/g, '')));
      }
    }

    return Math.round(element.distance.value / 1609);

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

  const { messages, costConfig: clientCostConfig, locale: rawLocale } = body || {};
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
      ? await fetchCostConfigRecord(base44, user.email)
      : null;

    // --- AUTO-FIX: Limpiar valores corruptos (como el 1838) del perfil ---
    if (user && costConfigRecord && costConfigRecord.pago_camion_rpm > 100) {
      await persistPagoCamion(base44, user.email, costConfigRecord, null);
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
    if (defaultEquipment) {
      systemContext += `\n\nEQUIPO PREDETERMINADO DEL VEHÍCULO DEL USUARIO: ${defaultEquipment}
     Si el dispatcher no menciona otro equipo, usa este equipo como valor de equipo.`;
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
    
    if (costConfig && !isNaN(parsedCpm)) {
      costoPorMillaPropio = parsedCpm;
      const diesel = costConfig.diesel_precio != null ? Number(costConfig.diesel_precio) : COSTCONFIG_DEFAULTS.diesel_precio;
      const mpg = costConfig.mpg != null ? Number(costConfig.mpg) : COSTCONFIG_DEFAULTS.mpg;
      const objetivo = costConfig.tarifa_objetivo != null ? Number(costConfig.tarifa_objetivo) : COSTCONFIG_DEFAULTS.tarifa_objetivo;
      const breakEven = costConfig.tarifa_break_even != null ? Number(costConfig.tarifa_break_even) : null;
      
      costConfigValuesShown = [diesel, mpg, parsedCpm, breakEven, objetivo];
      systemContext += `\n\nCOSTOS PERSONALIZADOS DEL USUARIO (solo contexto de rentabilidad para respuestas generales; el piso de rate_check usa "pago_camion_rpm" cuando la tabla no lo trae — ver Decisión 9-B):
- Diésel: $${diesel}/gal | MPG: ${mpg}
- Costo/milla: $${parsedCpm.toFixed(2)} | Break-even: $${breakEven ? breakEven.toFixed(2) : 'N/A'}/mi
- Objetivo: $${objetivo}/mi`;
    }

    const prompt = buildExtractionPrompt(systemContext, cappedMessages, locale);
    const raw = await extractWithRetry(base44, prompt);

    if (!raw) {
      return Response.json({ content: safeFallbackContent(locale) });
    }
    console.log(`[entry] Extracted: intent=${raw.intent}, origen=${raw.origen}, destino=${raw.destino}, millas=${raw.millas_ida}`);
    // Guardarraíl: Forzar drayage si la ruta existe en BD y el usuario no especificó equipo explícitamente
    const ultimoMensajeLower = ultimoMensajeDelDispatcher(cappedMessages).toLowerCase();
    const mencionoEquipo = ['van', 'reefer', 'flat', 'step', 'power'].some(e => ultimoMensajeLower.includes(e));
    
    if (!mencionoEquipo) {
      const locDestino = raw.destino ? resolveLocation(raw.destino) : { status: 'ask' };
      const locOrigen = raw.origen ? resolveLocation(raw.origen) : { status: 'ask' };
      
      if (locDestino.status === 'ok' || locOrigen.status === 'ok') {
        raw.equipo = 'drayage';
      }
    }

    if (!raw.equipo || raw.equipo === 'unknown') {
      if (defaultEquipment) {
        raw.equipo = defaultEquipment;
      }
    }

    // Guardarraíl de tema (Decisión 1): decide el intent en código, no confía
    // ciegamente en lo que devolvió el LLM. Va antes de cualquier cálculo.
    const intent = resolveIntent(raw.intent, cappedMessages);
    // Google Maps: si hay origen y destino pero no millas → calculamos automático.
    // Va aquí porque necesita que `raw` e `intent` ya estén declarados.
    // Usamos !raw.millas_ida para cubrir null, undefined, y 0 (que a veces el LLM arroja si no sabe).
    if (intent === 'rate_check' && !raw.millas_ida && raw.origen && raw.destino) {
      raw.millas_ida = await fetchDrivingMiles(raw.origen, raw.destino);
    }

    // reglas-v3-multiestado Fase 7 (criterio 4): validador automático de la
    // frontera LLM/datos. Corre SIEMPRE, para toda respuesta, justo antes de
    // devolverla — no es opcional ni depende del intent. Si aparece una cifra
    // fuera del conjunto autorizado, la respuesta NUNCA sale cruda: se
    // reemplaza por `buildBoundaryFallbackMarkdown()`.
    const conFronteraVerificada = (texto: string, permitidas: Set<number>): string => {
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
    const ultimoMsg = ultimoMensajeDelDispatcher(cappedMessages);
    const msgSinComas = ultimoMsg.replace(/,/g, '');
    
    if (raw.pago_camion != null && !msgSinComas.includes(raw.pago_camion.toString())) {
      raw.pago_camion = null;
    }
    if (raw.tarifa_ofrecida != null && !msgSinComas.includes(raw.tarifa_ofrecida.toString())) {
      raw.tarifa_ofrecida = null;
    }
    // --------------------------------------------------- 
    
    const truckPayment = resolveTruckPayment(costConfigRecord, raw.pago_camion);
    if (truckPayment.shouldPersist && truckPayment.rpm != null) {
      await persistPagoCamion(base44, user.email, costConfigRecord, truckPayment.rpm);
    }

    const tarifaOfrecida = typeof raw.tarifa_ofrecida === 'number' && isFinite(raw.tarifa_ofrecida) && raw.tarifa_ofrecida > 0
      ? raw.tarifa_ofrecida
      : null;

    let content: string;
    let calculo: CalculatedQuote | null = null;

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
          equipment: resolvedEquipment.equipment,
          millasIdaDeclaradas: raw.millas_ida,
          pagoCamionRpm: truckPayment.rpm,
          tarifaOfrecida,
          costoPorMillaPropio,
          tarifaObjetivaPropia: costConfig.tarifa_objetivo != null ? Number(costConfig.tarifa_objetivo) : null,
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

  } catch (_error) {
    // Cualquier falla inesperada retorna respuesta segura, nunca 500 con stack trace.
    return Response.json({ content: safeFallbackContent(locale) });
  }
});
