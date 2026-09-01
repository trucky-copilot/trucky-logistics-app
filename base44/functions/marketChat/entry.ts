import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// El dominio puro (datos de tarifas, cálculo de piso/objetivo/veredicto, la
// resolución de equipo y el armado de la respuesta) vive en ./rateEngine.ts
// para poder cubrirlo con `deno test`.
// Acá queda solo lo que necesita I/O: el prompt, la llamada al LLM, la lectura
// de CostConfig y el handler HTTP.
import {
  FREIGHT_KB_VERSION,
  EQUIPMENT_BENCHMARKS,
  DETENTION,
  ACCESSORIALS,
  HOS_LIMITS,
  DEADHEAD_THRESHOLDS,
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
} from './llmDataBoundary.ts';

const ROUTE_COUNTS = getRouteCounts();

const EQUIPMENT_LINES = EQUIPMENT_BENCHMARKS
  .map(e => `- ${e.id} (${e.label}): $${e.rpm_target.toFixed(2)}/mi`)
  .join('\n');

const ACCESSORIALS_LINE = ACCESSORIALS
  .map(a => a.min === a.max
    ? `${a.label} $${a.min}${a.unit || ''}`
    : `${a.label} $${a.min}-${a.max}${a.unit || ''}`)
  .join(' | ');

const BASE_CONTEXT = `Eres TruckyAI, el asistente de inteligencia de mercado para dispatchers y carriers de drayage y freight en Florida y Texas.

[Freight Dispatcher KB v${FREIGHT_KB_VERSION}]

VOCABULARIO DEL MERCADO (siempre interpreta correctamente):
- FIT = Florida International Terminal (Medley/Hialeah, zona de PortMiami)
- POMTOC / SFCT = terminales de PortMiami
- PET / Broward / Everglades = Port Everglades (Fort Lauderdale)
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

MERCADOS CUBIERTOS POR TABLA REAL DE TARIFAS: Florida (${ROUTE_COUNTS.fl} rutas de drayage) y Texas (${ROUTE_COUNTS.tx} rutas de drayage, Houston/Dallas-Ft Worth/El Paso). Para cualquier otro estado, o para cualquier equipo que no sea drayage, NO hay tabla: se calcula por RPM y se declara como cálculo — nunca se rechaza por falta de tabla.

RPM BASE POR EQUIPO (7 tipos — usa estos IDs exactos al extraer "equipo"; el número de piso/objetivo real lo calcula el código, no lo inventes):
${EQUIPMENT_LINES}

DETENTION: único valor válido en toda respuesta — $${DETENTION.standard}/hr estándar tras ${DETENTION.free_hours}h libres (rango $${DETENTION.min}-$${DETENTION.max}/hr). NUNCA menciones otra cifra de detention.
ACCESSORIALS: ${ACCESSORIALS_LINE}

DEADHEAD: <${DEADHEAD_THRESHOLDS.ok_pct}% millas cargadas=OK | ${DEADHEAD_THRESHOLDS.ok_pct}-${DEADHEAD_THRESHOLDS.concerning_pct}%=Preocupante | >${DEADHEAD_THRESHOLDS.concerning_pct}%=Deal-breaker. Si deadhead >${DEADHEAD_THRESHOLDS.long_deadhead_miles}mi, pedir $${DEADHEAD_THRESHOLDS.extra_rpm_min.toFixed(2)}-$${DEADHEAD_THRESHOLDS.extra_rpm_max.toFixed(2)}/mi adicional.

HOS: ${HOS_LIMITS.driving_hours}h conducción diaria | ${HOS_LIMITS.on_duty_hours}h on-duty | Pausa ${HOS_LIMITS.break_minutes}min tras ${HOS_LIMITS.break_after_hours}h conduciendo | ${HOS_LIMITS.hours_8_days}h/8días o ${HOS_LIMITS.hours_7_days}h/7días.

REGLAS CRÍTICAS DE RESPUESTA (aplican solo a "respuesta_general" — los cálculos de tarifa de rate_check se hacen en código, no aquí):
1. Respuestas MUY CORTAS — máximo 5 líneas. El dispatcher no quiere leer párrafos.
2. NUNCA sugerir "busca carga de regreso" — eso lo maneja el dispatcher, no el broker.
3. NUNCA inventes cifras de tarifas, millas o mínimos que no estén en esta KB — si no las tienes, dilo.
4. Para preguntas que no son de ruta, responde en máximo 3 líneas.
5. IDENTIDAD: la empresa del usuario es únicamente la que aparezca en el bloque "EMPRESA DEL USUARIO". Si ese bloque no está, NO tienes ese dato: dilo y NUNCA nombres ni supongas una empresa. Jamás menciones el nombre de ninguna otra empresa como si fuera la del usuario.`;

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

function buildExtractionPrompt(systemContext, cappedMessages) {
  const conversationHistory = cappedMessages
    .map(m => `${m.role === 'user' ? 'Dispatcher' : 'TruckyAI'}: ${m.content}`)
    .join('\n\n');

  return `${systemContext}

=== CONVERSACIÓN ===
${conversationHistory}

=== INSTRUCCIONES DE EXTRACCIÓN ===
Analiza el ÚLTIMO mensaje del Dispatcher dentro del contexto de la conversación y extrae los datos según el schema. Reglas:
- intent="rate_check" solo si el dispatcher pregunta por una tarifa/ruta específica.
- intent="off_topic" solo si el mensaje NO tiene relación con freight, dispatch u operación de carriers — por ejemplo: programación, clima, deportes, recetas, política, traducción, chistes, o aritmética sin referencia a freight, consejos personales, u otras industrias.
- intent="general" en cualquier otro caso: freight, drayage, puertos, brokers, carriers, equipo, documentos (rate confirmation, BOL), costos (diésel, MPG, peajes), regulación (HOS, TWIC, DOT), cargos (detention, per diem, demurrage, TONU, chassis split), geografía del mercado — incluso frases genéricas como "¿cuánto está el diésel?", "¿qué es TWIC?" o "¿qué es un chasis?".
- Ante la duda usa "general". Nunca uses "off_topic" si el mensaje menciona algún término de la KB.
- Ejemplos de off_topic: "¿cómo escribo un for loop en Python?" · "¿cómo está el clima en Miami hoy?" · "¿quién ganó el partido de fútbol de ayer?" · "dame una receta de arroz con pollo" · "¿qué opinas de las elecciones?" · "¿cuánto es 15% de 2400?" · "traduce 'hello' al español" · "cuéntame un chiste".
- Ejemplos que SÍ son general aunque suenen genéricos: "¿cuánto está el diésel?" · "¿qué es TWIC?" · "¿qué es un chasis?" · "¿cuánto es 15% de una carga de $2,400?" (tiene referente de freight).
- origen/destino: nombres de ciudad, ZIP o el alias/terminal tal como los menciona el dispatcher (p. ej. "POMTOC", "PortMiami", un ZIP de Texas); usa null si no aparecen.
- millas_ida: SOLO si el dispatcher las dice explícitamente, en millas de SOLO IDA (una dirección); null si no las dice — nunca estimes.
- es_redondo: true por defecto; usa false solo si el dispatcher dice explícitamente "solo ida" o "one way".
- equipo: uno de dry_van, reefer, flatbed, step_deck, drayage, power_only; usa "unknown" si no se menciona o no coincide. El tamaño del contenedor (si aplica) va aparte, en "tamano" — NO lo mezcles acá.
- equipo="drayage": si el dispatcher dice "drayage" o "contenedor"/"container", usa "drayage" independientemente de si dijo el tamaño (el tamaño se extrae en "tamano").
- equipo, distinción reefer vs. contenedor: "reefer" es un trailer refrigerado (tarifa por RPM); un contenedor refrigerado que sale de puerto es un movimiento de drayage → usa "drayage", nunca "reefer".
- tamano: uno de 20, 40, 45, 20_heavy — SOLO si el dispatcher menciona el tamaño del contenedor (20', 40', 45', o "20 con sobrepeso"/"20 heavy"); usa "unknown" si no lo menciona o el equipo no es drayage.
- tarifa_ofrecida: el monto en dólares que el broker/shipper ofrece; null si no se menciona ninguna cifra.
- pago_camion: el RPM (dólares por milla) que el dispatcher dice que le paga al camión/carrier, SOLO si lo menciona explícitamente en este mensaje; null si no lo dice. No lo confundas con tarifa_ofrecida (eso es lo que el broker le paga al dispatcher).
- accessorial_triggers: lista de cargos accesoriales que el dispatcher menciona o cuyo gatillo describe (p. ej. "reefer", "hazmat", "pre-pull", "detention", "chassis"); arreglo vacío si no menciona ninguno.
- respuesta_general: SOLO para intent="general" — tu respuesta directa y completa a la pregunta del dispatcher, en máximo 5 líneas, en español, sin inventar cifras de tarifas o millas que no estén en el contexto.`;
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
  if (record) return record;
  if (clientCostConfig && typeof clientCostConfig === 'object' && clientCostConfig.costo_por_milla) {
    return clientCostConfig;
  }
  return COSTCONFIG_DEFAULTS;
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
    const [costConfigRecord, organizationName] = await Promise.all([
      fetchCostConfigRecord(base44, user.email),
      getOrganizationName(base44, user.email),
    ]);
    const costConfig = getCostConfig(costConfigRecord, clientCostConfig);

    let systemContext = BASE_CONTEXT;
    if (organizationName) {
      systemContext += `\n\nEMPRESA DEL USUARIO: ${organizationName}`;
    }
    // reglas-v3-multiestado Fase 6: costo_por_milla YA existía en CostConfig
    // (Calculadora) como contexto de rentabilidad; ahora ADEMÁS alimenta la
    // base "owner_operator" del veredicto por perfil (ver más abajo). Los
    // valores que se interpolan acá son exactamente los que entran al
    // conjunto autorizado de la frontera LLM/datos para "general" (Fase 7) —
    // el LLM puede repetirlos porque son dato real mostrado, no inventado.
    let costConfigValuesShown: Array<number | null | undefined> = [];
    let costoPorMillaPropio: number | null = null;
    if (costConfig && typeof costConfig.costo_por_milla === 'number') {
      costoPorMillaPropio = costConfig.costo_por_milla;
      const diesel = costConfig.diesel_precio ?? COSTCONFIG_DEFAULTS.diesel_precio;
      const mpg = costConfig.mpg ?? COSTCONFIG_DEFAULTS.mpg;
      const objetivo = costConfig.tarifa_objetivo ?? COSTCONFIG_DEFAULTS.tarifa_objetivo;
      costConfigValuesShown = [diesel, mpg, costConfig.costo_por_milla, costConfig.tarifa_break_even, objetivo];
      systemContext += `\n\nCOSTOS PERSONALIZADOS DEL USUARIO (solo contexto de rentabilidad para respuestas generales; el piso de rate_check usa "pago_camion_rpm" cuando la tabla no lo trae — ver Decisión 9-B):
- Diésel: $${diesel}/gal | MPG: ${mpg}
- Costo/milla: $${costConfig.costo_por_milla.toFixed(2)} | Break-even: $${costConfig.tarifa_break_even ? costConfig.tarifa_break_even.toFixed(2) : 'N/A'}/mi
- Objetivo: $${objetivo}/mi`;
    }

    const prompt = buildExtractionPrompt(systemContext, cappedMessages);
    const raw = await extractWithRetry(base44, prompt);

    if (!raw) {
      return Response.json({ content: safeFallbackContent() });
    }

    // Guardarraíl de tema (Decisión 1): decide el intent en código, no confía
    // ciegamente en lo que devolvió el LLM. Va antes de cualquier cálculo.
    const intent = resolveIntent(raw.intent, cappedMessages);

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
      return Response.json({ content: conFronteraVerificada(buildOffTopicMarkdown(), new Set()) });
    }

    if (intent === 'general') {
      const permitidasGeneral = buildGeneralIntentAllowedNumbers(costConfigValuesShown);
      return Response.json({ content: conFronteraVerificada(buildGeneralMarkdown(raw.respuesta_general), permitidasGeneral) });
    }

    // intent === 'rate_check'
    //
    // reglas-v3-multiestado Fase 3: ya NO hay guardarraíl geográfico que
    // rechace antes de calcular — el principio es "nunca se rechaza por falta
    // de tabla". Tampoco hay estimación de millas por IA: solo tabla, dato del
    // usuario, o se pregunta.

    // Pago al camión (Decisión 9-B): se resuelve antes del cálculo porque
    // computeFloorTarget lo usa como piso cuando no hay piso de tabla.
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
        content = buildEquipmentQuestionMarkdown('size');
      } else {
        const outcome = resolveDrayageQuote({
          destinoRaw: raw.destino,
          tamano,
          millasIdaDeclaradas: raw.millas_ida,
          pagoCamionRpm: truckPayment.rpm,
          tarifaOfrecida,
          accessorialTriggers: raw.accessorial_triggers,
          costoPorMillaPropio,
        });
        if (outcome.kind === 'ask_miles') {
          content = raw.destino ? buildAskMilesMarkdown(outcome.ciudadConocida) : buildMissingDataMarkdown();
        } else if (outcome.kind === 'fuera_de_rango') {
          content = buildSanityCapMarkdown();
        } else {
          calculo = outcome.calculo;
          content = buildRateCheckMarkdown(outcome.calculo);
          // reglas-v3-multiestado Fase 4 (Decisión 2-A): en drayage la doble
          // lectura NUNCA aparece por defecto — solo si el dispatcher pregunta
          // explícitamente por el total de ida y vuelta.
          if (preguntaPorTotalRedondo(ultimoMensajeDelDispatcher(cappedMessages))) {
            content += `\n\n${buildDrayageRoundTripMarkdown(outcome.calculo)}`;
          }
        }
      }
    } else {
      // Guardarraíl de equipo (TRUCKY-48 parcial): resolveEquipment nunca
      // sustituye un tipo de camión: si no está claro, se pregunta.
      const resolvedEquipment = resolveEquipment(raw.equipo);
      if (resolvedEquipment.status === 'ask') {
        content = buildEquipmentQuestionMarkdown(resolvedEquipment.reason);
      } else {
        const outcome = resolveGenericQuote({
          equipment: resolvedEquipment.equipment,
          millasIdaDeclaradas: raw.millas_ida,
          pagoCamionRpm: truckPayment.rpm,
          tarifaOfrecida,
          costoPorMillaPropio,
        });
        if (outcome.kind === 'ask_miles') {
          content = buildMissingDataMarkdown();
        } else if (outcome.kind === 'fuera_de_rango') {
          content = buildSanityCapMarkdown();
        } else {
          calculo = outcome.calculo;
          content = buildRateCheckMarkdown(outcome.calculo);
        }
      }
    }

    // El conjunto autorizado de un rate_check es EXACTAMENTE lo que trae el
    // bloque calculado; sin bloque calculado (preguntas de dato faltante,
    // tope de sanidad, pedir equipo/tamaño), esas respuestas son estáticas y
    // no traen ninguna cifra — el conjunto vacío las deja pasar tal cual.
    const permitidasRateCheck = calculo ? buildRateCheckAllowedNumbers(calculo) : new Set<number>();
    return Response.json({ content: conFronteraVerificada(content, permitidasRateCheck) });

  } catch (_error) {
    // Cualquier falla inesperada retorna respuesta segura, nunca 500 con stack trace.
    return Response.json({ content: safeFallbackContent() });
  }
});
