// ─────────────────────────────────────────────────────────────────────────────
// CATÁLOGO DE MENSAJES — todo el texto visible del Chat de Mercado, por idioma.
//
// Módulo hermano de rateEngine.ts, sin dependencias entre sí en ninguna
// dirección (Base44 empaqueta ambos archivos igual). No hace I/O ni depende
// de estado global: solo datos y funciones puras sobre esos datos.
//
// REGLA: ningún literal de texto visible al usuario debe vivir hardcodeado en
// rateEngine.ts ni en entry.ts. Si el texto cambia según el idioma, sale de
// MESSAGES; si es invariante (labels de equipo, nombres propios, cifras), no
// entra al catálogo.
//
// SHAPE de las hojas: una hoja es un `string` (texto fijo, sin interpolación)
// o un `{ parts: string[] }` — fragmentos estáticos alrededor de los puntos de
// interpolación, para que `render()` los una y `collectStaticFragments()` los
// pueda recorrer mecánicamente sin listas mantenidas a mano.
//
// reglas-v3-multiestado (reconciliación con chat-idioma-toggle): el motor de
// tarifas se reescribió por completo (tabla-primero + cálculo-siempre, 259
// rutas) en paralelo a este catálogo. Las hojas de `rateCheck`/`askMiles`/
// `sanityCap`/`drayageRoundTrip`/`marginVerdict` de esta sección reemplazan
// las del árbol viejo (basado en `RateCheckContext`/lanes/flat-minimums, que
// ya no existe) por las que consume el nuevo `CalculatedQuote` — mismo
// mecanismo de catálogo, contenido informativo nuevo.
// ─────────────────────────────────────────────────────────────────────────────

export type Locale = 'es' | 'en';

export type Leaf = string | { parts: string[] };

export interface CatalogTree {
  [key: string]: Leaf | CatalogTree;
}

function isLeaf(node: unknown): node is Leaf {
  if (typeof node === 'string') return true;
  return !!node && typeof node === 'object' && Array.isArray((node as { parts?: unknown }).parts);
}

// Shapes por dominio — evitan castear `CatalogTree` en cada builder de
// rateEngine.ts. `MESSAGES` sigue siendo asignable a `Record<Locale,
// CatalogTree>` (estructuralmente compatible) para la prueba de paridad T1.1.
export interface VerdictMessages extends CatalogTree {
  reference: string;
  reject: string;
  negotiate: string;
  accept: string;
}

// reglas-v3-multiestado: hojas que consume el nuevo `buildRateCheckMarkdown(q:
// CalculatedQuote, locale)`. Cada campo de acá tiene un call site concreto en
// rateEngine.ts — ver el comentario junto a cada builder.
export interface RateCheckMessages extends CatalogTree {
  fallbackRuta: string;
  milesIdaSuffix: string;
  userDataTag: string;
  headerLine: { parts: string[] };
  targetTabla: { parts: string[] };
  targetDerivadoPrefix: { parts: string[] };
  targetDerivadoDobleSupuesto: string;
  targetDerivadoSimple: string;
  targetTramoCorto: { parts: string[] };
  targetCalculo: { parts: string[] };
  floorTabla: { parts: string[] };
  floorDatoUsuario: { parts: string[] };
  floorTramoCorto: { parts: string[] };
  floorSinDato: string;
  segundaLecturaLine: { parts: string[] };
  referenciasEstadoLabel: { parts: string[] };
  referenciasGeneralLabel: string;
  referenciaItemLine: { parts: string[] };
  accesorialesPropios: { parts: string[] };
  accesorialesHeredados: { parts: string[] };
  accesorialItemLine: { parts: string[] };
  estadoGenericoFallback: string;
  txFuelSurchargeWarning: string;
  ofertaVerdictLine: { parts: string[] };
}

export interface AskMilesMessages extends CatalogTree {
  line1: { parts: string[] };
  line2: string;
}

export interface SanityCapMessages extends CatalogTree {
  line1: string;
  line2: string;
}

export interface DrayageRoundTripMessages extends CatalogTree {
  includedLine: { parts: string[] };
  includedDistanceLine: { parts: string[] };
  hypothesisLine: { parts: string[] };
  estimatedDistanceLine: { parts: string[] };
}

export interface MarginVerdictMessages extends CatalogTree {
  baseLabelPagoCamion: string;
  baseLabelCostoPropio: string;
  bandFuerte: string;
  bandAjustado: string;
  bandDebil: string;
  line: { parts: string[] };
  masRestrictivoLine: { parts: string[] };
}

export interface EquipmentQuestionMessages extends CatalogTree {
  sizeIntro: string;
  sizeQuestion: string;
  missingIntro: string;
  missingQuestion: string;
}

export interface OffTopicMessages extends CatalogTree {
  line1: string;
  line2: string;
}

export interface MissingDataMessages extends CatalogTree {
  line1: string;
  line2: string;
}

export interface SafeFallbackMessages extends CatalogTree {
  content: string;
}

export interface UnitsMessages extends CatalogTree {
  perDay: string;
}

export interface ExtractionMessages extends CatalogTree {
  // Única línea del meta-prompt de extracción (LLM-facing, no visible al
  // usuario) que cambia por locale — ver buildExtractionPrompt en entry.ts.
  // El resto de ese meta-prompt queda en español, fuera de scope (Design).
  languageDirective: string;
}

// Insumos derivados que entry.ts calcula UNA vez (locale-neutral: cifras,
// labels de equipo, conteos de tabla) y pasa a la función de BASE_CONTEXT del
// locale activo. `accessorialsLine` SÍ depende del locale (buildAccessorialsLine)
// y entry.ts la recalcula por request.
export interface BaseContextInputs {
  freightKbVersion: string;
  equipmentLines: string;
  routeCountFl: number;
  routeCountTx: number;
  accessorialsLine: string;
  detentionStandard: number;
  detentionFreeHours: number;
  detentionMin: number;
  detentionMax: number;
  deadheadOkPct: number;
  deadheadConcerningPct: number;
  deadheadLongMiles: number;
  deadheadExtraMin: number;
  deadheadExtraMax: number;
  hosDrivingHours: number;
  hosOnDutyHours: number;
  hosBreakMinutes: number;
  hosBreakAfterHours: number;
  hos8Days: number;
  hos7Days: number;
}

export type BaseContextBuilder = (inputs: BaseContextInputs) => string;

export interface LocaleMessages {
  verdict: VerdictMessages;
  rateCheck: RateCheckMessages;
  askMiles: AskMilesMessages;
  sanityCap: SanityCapMessages;
  drayageRoundTrip: DrayageRoundTripMessages;
  marginVerdict: MarginVerdictMessages;
  equipmentQuestion: EquipmentQuestionMessages;
  offTopic: OffTopicMessages;
  missingData: MissingDataMessages;
  safeFallback: SafeFallbackMessages;
  units: UnitsMessages;
  extraction: ExtractionMessages;
  // Dos plantillas autoradas independientemente (no traducción 1:1) — ver
  // comentario junto a MESSAGES.en.baseContext.
  baseContext: BaseContextBuilder;
}

export const MESSAGES: Record<Locale, LocaleMessages> = {
  es: {
    verdict: {
      reference: 'REFERENCIA',
      reject: 'TE SUGIERO PEDIR MÁS',
      negotiate: 'TE SUGIERO NEGOCIAR',
      accept: 'TE SUGIERO TOMARLA',
    },
    rateCheck: {
      fallbackRuta: 'la ruta consultada',
      milesIdaSuffix: ' mi de ida',
      userDataTag: ' · dato del usuario',
      headerLine: { parts: ['📊 ', ' (', ') · ', ''] },
      targetTabla: { parts: ['Objetivo de tabla: ', ''] },
      targetDerivadoPrefix: { parts: ["Objetivo derivado del 40' de tabla: ", ''] },
      targetDerivadoDobleSupuesto: ' · doble supuesto: se aplica un factor estándar de industria sobre OTRO factor estándar de industria, no es tarifa de tabla',
      targetDerivadoSimple: ' · derivado, no es tarifa de tabla',
      targetTramoCorto: { parts: ['Objetivo de tramo corto (mínimo de referencia bajo ', ' mi): ', ''] },
      targetCalculo: { parts: ['Objetivo calculado (RPM × millas): ', ''] },
      floorTabla: { parts: ['Piso de tabla: ', ''] },
      floorDatoUsuario: { parts: ['Piso desde tu dato (lo que le pagás al camión): ', ''] },
      floorTramoCorto: { parts: ['Piso de tramo corto (mínimo de referencia bajo ', ' mi): ', ' · si querés afinarlo decime tu costo por día'] },
      floorSinDato: 'Sin piso: no tengo tu costo por milla ni lo que le pagás al camión.',
      segundaLecturaLine: { parts: ['🔁 Segunda lectura — HIPÓTESIS (regreso vacío, no es un dato confirmado): si el camión vuelve vacío recorriendo las mismas millas, ese mismo pago equivale a $', '/mi sobre ', ' mi ida y vuelta.'] },
      referenciasEstadoLabel: { parts: ['Rutas cercanas de referencia en ', ' (no es una cotización de esta ruta):'] },
      referenciasGeneralLabel: 'Valores de referencia general del mercado (no es una cotización de esta ruta):',
      referenciaItemLine: { parts: ['- ', ' (', ' mi): ', ''] },
      accesorialesPropios: { parts: ['Accesoriales de ', ':'] },
      accesorialesHeredados: { parts: ['Accesoriales heredados de ', ' (tu ruta no tiene tabla propia de accesoriales; la tarifa de arriba NO sale de ahí):'] },
      accesorialItemLine: { parts: ['- ', ': ', ''] },
      estadoGenericoFallback: 'el mercado',
      txFuelSurchargeWarning: '⚠️ El Fuel Surcharge de Texas ya está incluido en la tarifa de tabla de arriba — no se suma aparte. En la confirmación con el bróker suele presentarse por separado; conviene verificarlo ahí.',
      ofertaVerdictLine: { parts: ['', ' Te ofrecen ', ' → ', ''] },
    },
    askMiles: {
      line1: { parts: ['📊 No tengo esa ruta en mi tabla', ', así que necesito las millas de ida para calcular.'] },
      line2: 'Decime las millas y te doy el número — nunca las estimo por mi cuenta.',
    },
    sanityCap: {
      line1: '⚠️ Con esas millas no tengo una referencia confiable para calcular por milla.',
      line2: 'Pásame las millas exactas, o lo que le pagás al camión, y te doy un número defendible.',
    },
    drayageRoundTrip: {
      includedLine: { parts: ['🔁 La tarifa de tabla (', ') ya incluye ida, vuelta y devolución del equipo — no hay nada que sumar.'] },
      includedDistanceLine: { parts: ['Distancia total del movimiento: ~', ' mi.'] },
      hypothesisLine: { parts: ['🔁 Total aproximado ida y vuelta: ', ' — HIPÓTESIS: asumimos que el regreso recorre las mismas ', ' mi; no es un dato confirmado de tabla.'] },
      estimatedDistanceLine: { parts: ['Distancia total estimada: ~', ' mi.'] },
    },
    marginVerdict: {
      baseLabelPagoCamion: 'lo que le pagás al camión',
      baseLabelCostoPropio: 'tu costo propio declarado',
      bandFuerte: 'margen fuerte',
      bandAjustado: 'margen ajustado, vale la pena comparar otras opciones',
      bandDebil: 'margen débil frente a ese costo',
      line: { parts: ['', ' Margen vs. ', ': ', ' (', '%) → ', ''] },
      masRestrictivoLine: { parts: ['Entre las dos bases, la más restrictiva es "', '" — con esa conviene comparar antes de confirmar.'] },
    },
    equipmentQuestion: {
      sizeIntro: '📦 Para darte un piso preciso necesito el tamaño del contenedor.',
      sizeQuestion: "¿Es un contenedor de 20', 40', 45' o 20' Heavy?",
      missingIntro: '📦 Para calcular el piso necesito saber el equipo.',
      missingQuestion: '¿Con qué equipo lo mueves? (dry van, reefer, flatbed, step deck, drayage, power only)',
    },
    offTopic: {
      line1: '🚚 Solo manejo temas de freight: tarifas, rutas y operación de drayage en el sur de Florida.',
      line2: 'Pregúntame por tarifas, rutas u operación y te respondo al instante.',
    },
    missingData: {
      line1: '📊 Necesito más datos para calcular el piso y el objetivo.',
      line2: 'Dime origen, destino, equipo y millas (de ida) — con eso te doy el número exacto.',
    },
    safeFallback: {
      content: '⚠️ No pude procesar la consulta; reintenta. Para tarifas incluye origen, destino, millas y equipo.',
    },
    units: {
      perDay: '/día',
    },
    extraction: {
      languageDirective: 'en español',
    },
    // reglas-v3-multiestado: reemplaza el CATÁLOGO DE RUTAS DE REFERENCIA /
    // MÍNIMOS FLAT RATE de la versión chat-idioma-toggle original (conceptos
    // eliminados por Fase 3 — ver cabecera de rateEngine.ts) por la descripción
    // del mercado tabla-primero + cálculo-siempre. DEADHEAD/HOS pasan a
    // interpolarse desde HOS_LIMITS/DEADHEAD_THRESHOLDS (única fuente de
    // verdad, Fase 7) en vez de quedar como literales fijos — mismo contenido
    // numérico que la versión anterior.
    baseContext: (i) => `Eres TruckyAI, el asistente de inteligencia de mercado para dispatchers y carriers de drayage y freight en Florida y Texas.

[Freight Dispatcher KB v${i.freightKbVersion}]

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

MERCADOS CUBIERTOS POR TABLA REAL DE TARIFAS: Florida (${i.routeCountFl} rutas de drayage) y Texas (${i.routeCountTx} rutas de drayage, Houston/Dallas-Ft Worth/El Paso). Para cualquier otro estado, o para cualquier equipo que no sea drayage, NO hay tabla: se calcula por RPM y se declara como cálculo — nunca se rechaza por falta de tabla.

RPM BASE POR EQUIPO (7 tipos — usa estos IDs exactos al extraer "equipo"; el número de piso/objetivo real lo calcula el código, no lo inventes):
${i.equipmentLines}

DETENTION: único valor válido en toda respuesta — $${i.detentionStandard}/hr estándar tras ${i.detentionFreeHours}h libres (rango $${i.detentionMin}-$${i.detentionMax}/hr). NUNCA menciones otra cifra de detention.
ACCESSORIALS: ${i.accessorialsLine}

DEADHEAD: <${i.deadheadOkPct}% millas cargadas=OK | ${i.deadheadOkPct}-${i.deadheadConcerningPct}%=Preocupante | >${i.deadheadConcerningPct}%=Deal-breaker. Si deadhead >${i.deadheadLongMiles}mi, pedir $${i.deadheadExtraMin.toFixed(2)}-$${i.deadheadExtraMax.toFixed(2)}/mi adicional.

HOS: ${i.hosDrivingHours}h conducción diaria | ${i.hosOnDutyHours}h on-duty | Pausa ${i.hosBreakMinutes}min tras ${i.hosBreakAfterHours}h conduciendo | ${i.hos8Days}h/8días o ${i.hos7Days}h/7días.

REGLAS CRÍTICAS DE RESPUESTA (aplican solo a "respuesta_general" — los cálculos de tarifa de rate_check se hacen en código, no aquí):
1. Respuestas MUY CORTAS — máximo 5 líneas. El dispatcher no quiere leer párrafos.
2. NUNCA sugerir "busca carga de regreso" — eso lo maneja el dispatcher, no el broker.
3. NUNCA inventes cifras de tarifas, millas o mínimos que no estén en esta KB — si no las tienes, dilo.
4. Para preguntas que no son de ruta, responde en máximo 3 líneas.
5. IDENTIDAD: la empresa del usuario es únicamente la que aparezca en el bloque "EMPRESA DEL USUARIO". Si ese bloque no está, NO tienes ese dato: dilo y NUNCA nombres ni supongas una empresa. Jamás menciones el nombre de ninguna otra empresa como si fuera la del usuario.`,
  },
  en: {
    verdict: {
      reference: 'REFERENCE',
      reject: 'I SUGGEST ASKING FOR MORE',
      negotiate: 'I SUGGEST NEGOTIATING',
      accept: 'I SUGGEST TAKING IT',
    },
    rateCheck: {
      fallbackRuta: 'the requested route',
      milesIdaSuffix: ' mi one way',
      userDataTag: ' · user-provided',
      headerLine: { parts: ['📊 ', ' (', ') · ', ''] },
      targetTabla: { parts: ['Table target: ', ''] },
      targetDerivadoPrefix: { parts: ["Target derived from the table 40': ", ''] },
      targetDerivadoDobleSupuesto: ' · double assumption: a standard industry factor is applied on top of ANOTHER standard industry factor, this is not a table rate',
      targetDerivadoSimple: ' · derived, not a table rate',
      targetTramoCorto: { parts: ['Short-haul target (reference minimum under ', ' mi): ', ''] },
      targetCalculo: { parts: ['Calculated target (RPM × miles): ', ''] },
      floorTabla: { parts: ['Table floor: ', ''] },
      floorDatoUsuario: { parts: ['Floor from your data (what you pay the truck): ', ''] },
      floorTramoCorto: { parts: ['Short-haul floor (reference minimum under ', ' mi): ', ' · tell me your daily cost to refine it'] },
      floorSinDato: "No floor: I don't have your cost per mile or what you pay the truck.",
      segundaLecturaLine: { parts: ['🔁 Second reading — HYPOTHESIS (empty return, not a confirmed figure): if the truck returns empty covering the same miles, that same pay equals $', '/mi over ', ' round-trip mi.'] },
      referenciasEstadoLabel: { parts: ['Nearby reference routes in ', ' (not a quote for this route):'] },
      referenciasGeneralLabel: 'General market reference values (not a quote for this route):',
      referenciaItemLine: { parts: ['- ', ' (', ' mi): ', ''] },
      accesorialesPropios: { parts: ['Accessorials from ', ':'] },
      accesorialesHeredados: { parts: ['Accessorials inherited from ', ' (your route has no accessorials table of its own; the rate above does NOT come from there):'] },
      accesorialItemLine: { parts: ['- ', ': ', ''] },
      estadoGenericoFallback: 'the market',
      txFuelSurchargeWarning: "⚠️ The Texas Fuel Surcharge is already included in the table rate above — do not add it separately. It's often shown separately on the broker's rate confirmation; worth double-checking there.",
      ofertaVerdictLine: { parts: ['', ' They are offering ', ' → ', ''] },
    },
    askMiles: {
      line1: { parts: ["📊 I don't have that route in my table", ', so I need the one-way miles to calculate.'] },
      line2: "Tell me the miles and I'll give you the number — I never estimate them on my own.",
    },
    sanityCap: {
      line1: "⚠️ With those miles I don't have a reliable per-mile reference to calculate.",
      line2: "Send me the exact miles, or what you pay the truck, and I'll give you a defensible number.",
    },
    drayageRoundTrip: {
      includedLine: { parts: ['🔁 The table rate (', ') already includes there, back, and equipment return — nothing to add.'] },
      includedDistanceLine: { parts: ['Total movement distance: ~', ' mi.'] },
      hypothesisLine: { parts: ['🔁 Approximate round-trip total: ', ' — HYPOTHESIS: assumes the return covers the same ', ' mi; not a confirmed table figure.'] },
      estimatedDistanceLine: { parts: ['Estimated total distance: ~', ' mi.'] },
    },
    marginVerdict: {
      baseLabelPagoCamion: 'what you pay the truck',
      baseLabelCostoPropio: 'your declared own cost',
      bandFuerte: 'strong margin',
      bandAjustado: 'tight margin, worth comparing other options',
      bandDebil: 'weak margin against that cost',
      line: { parts: ['', ' Margin vs. ', ': ', ' (', '%) → ', ''] },
      masRestrictivoLine: { parts: ['Between the two bases, the most restrictive is "', '" — worth comparing before confirming.'] },
    },
    equipmentQuestion: {
      sizeIntro: '📦 To give you an accurate floor I need the container size.',
      sizeQuestion: "Is it a 20', 40', 45', or 20' Heavy container?",
      missingIntro: '📦 To calculate the floor I need to know the equipment.',
      missingQuestion: 'What equipment are you moving it with? (dry van, reefer, flatbed, step deck, drayage, power only)',
    },
    offTopic: {
      line1: '🚚 I only handle freight topics: rates, routes, and drayage operations in South Florida.',
      line2: "Ask me about rates, routes, or operations and I'll answer instantly.",
    },
    missingData: {
      line1: '📊 I need more data to calculate the floor and target.',
      line2: "Tell me origin, destination, equipment, and miles (one way) — with that I'll give you the exact number.",
    },
    safeFallback: {
      content: "⚠️ I couldn't process the request; please retry. For rates include origin, destination, miles, and equipment.",
    },
    units: {
      perDay: '/day',
    },
    extraction: {
      languageDirective: 'in English',
    },
    // Autorado, NO traducido: se omite el glosario "VOCABULARIO DEL MERCADO"
    // porque para un lector angloparlante fluido drayage/backhaul/detention/
    // per diem/demurrage/TONU/void check son vocabulario nativo, no siglas que
    // haya que explicar. Se conservan únicamente los acrónimos propios de esta
    // KB (FIT, POMTOC, SFCT, PET, Pompano, WPB) — códigos internos del
    // proyecto, no vocabulario general de freight. Mismas 5 reglas críticas,
    // mismo guardarraíl de identidad, mismo contenido numérico (Design).
    baseContext: (i) => `You are TruckyAI, the market intelligence assistant for dispatchers and carriers of drayage and freight in Florida and Texas.

[Freight Dispatcher KB v${i.freightKbVersion}]

KB-SPECIFIC LOCATION CODES:
- FIT = Florida International Terminal (Medley/Hialeah, PortMiami area)
- POMTOC / SFCT = PortMiami terminals
- PET / Broward / Everglades = Port Everglades (Fort Lauderdale)
- Pompano = Pompano Beach, FL
- WPB = West Palm Beach, FL

MARKETS COVERED BY A REAL RATE TABLE: Florida (${i.routeCountFl} drayage routes) and Texas (${i.routeCountTx} drayage routes, Houston/Dallas-Ft Worth/El Paso). For any other state, or for any non-drayage equipment, there is no table: the rate is calculated by RPM and declared as a calculation — never rejected for lack of a table.

EQUIPMENT RPM BASE (7 types — use these exact IDs when extracting "equipo"; the code calculates the real floor/target number, do not invent it):
${i.equipmentLines}

DETENTION: the only valid figure across the whole response — $${i.detentionStandard}/hr standard after ${i.detentionFreeHours}h free (range $${i.detentionMin}-$${i.detentionMax}/hr). NEVER mention a different detention figure.
ACCESSORIALS: ${i.accessorialsLine}

DEADHEAD: <${i.deadheadOkPct}% loaded miles=OK | ${i.deadheadOkPct}-${i.deadheadConcerningPct}%=Concerning | >${i.deadheadConcerningPct}%=Deal-breaker. If deadhead is over ${i.deadheadLongMiles}mi, ask for an extra $${i.deadheadExtraMin.toFixed(2)}-$${i.deadheadExtraMax.toFixed(2)}/mi.

HOS: ${i.hosDrivingHours}h daily driving | ${i.hosOnDutyHours}h on-duty | ${i.hosBreakMinutes}min break after ${i.hosBreakAfterHours}h driving | ${i.hos8Days}h/8days or ${i.hos7Days}h/7days.

CRITICAL RESPONSE RULES (apply only to "respuesta_general" — rate_check calculations are handled in code, not here):
1. VERY SHORT responses — 5 lines max. The dispatcher doesn't want to read paragraphs.
2. NEVER suggest "look for a backhaul load" — that's the dispatcher's call, not the broker's.
3. NEVER invent rate, mileage, or minimum figures that aren't in this KB — if you don't have them, say so.
4. For non-route questions, answer in 3 lines max.
5. IDENTITY: the user's company is ONLY the one that appears in the "USER'S COMPANY" block. If that block is absent, you do NOT have that data: say so and NEVER name or assume a company. Never mention any other company's name as if it were the user's.`,
  },
};

/**
 * Renderiza una hoja del catálogo. Si es un string fijo, lo devuelve tal
 * cual. Si es `{parts}`, intercala los argumentos entre los fragmentos
 * estáticos: parts[0] + args[0] + parts[1] + args[1] + ... + parts[n].
 */
export function render(leaf: Leaf, ...args: Array<string | number>): string {
  if (typeof leaf === 'string') return leaf;
  const { parts } = leaf;
  let out = parts[0] ?? '';
  for (let i = 0; i < args.length; i++) {
    out += String(args[i]) + (parts[i + 1] ?? '');
  }
  return out;
}

/**
 * Recorre todo el árbol del catálogo y junta cada fragmento estático (strings
 * sueltos y cada segmento de `parts[]`), filtrando ruido conector (≥3
 * caracteres no-espacio). Es la base de la verificación anti-mezcla (Fase 4):
 * la diferencia entre los fragmentos de `es` y los de `en` da lo que NUNCA
 * debería aparecer en la respuesta del idioma contrario.
 */
export function collectStaticFragments(tree: CatalogTree): string[] {
  const out: string[] = [];

  const pushIfSignificant = (s: string) => {
    if (s.replace(/\s/g, '').length >= 3) out.push(s);
  };

  const visit = (node: Leaf | CatalogTree) => {
    if (typeof node === 'string') {
      pushIfSignificant(node);
      return;
    }
    if (isLeaf(node)) {
      for (const part of (node as { parts: string[] }).parts) pushIfSignificant(part);
      return;
    }
    for (const key of Object.keys(node)) {
      visit((node as CatalogTree)[key]);
    }
  };

  visit(tree);
  return out;
}

/** Allowlist de locale: cualquier valor fuera de ['es','en'] cae en 'es'. */
export function resolveLocale(raw: unknown): Locale {
  return raw === 'es' || raw === 'en' ? raw : 'es';
}
