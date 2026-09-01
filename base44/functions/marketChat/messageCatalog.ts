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

export interface RateCheckMessages extends CatalogTree {
  fallbackRuta: string;
  roundTripTag: string;
  oneWayTag: string;
  estimatedMilesSuffix: string;
  lowConfidenceSuffix: string;
  portSurchargeSuffix: { parts: string[] };
  flatBasisLine: { parts: string[] };
  rpmBasisLine: { parts: string[] };
  headerLine: { parts: string[] };
  locationLine: { parts: string[] };
  confirmPrompt: string;
  askOfferPrompt: string;
  adviceReject: { parts: string[] };
  adviceNegotiate: { parts: string[] };
  adviceAccept: string;
  posicionBajoPiso: string;
  posicionEntre: string;
  posicionSobre: string;
  tallyLine: { parts: string[] };
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

export interface OutOfMarketMessages extends CatalogTree {
  noRatesPrefix: string;
  coverageLine: string;
  confirmedRoutesLine: { parts: string[] };
  askMoreLine: string;
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
// labels de equipo/lane) y pasa a la función de BASE_CONTEXT del locale
// activo. `accessorialsLine` SÍ depende del locale (buildAccessorialsLine) y
// entry.ts la recalcula por request.
export interface BaseContextInputs {
  freightKbVersion: string;
  equipmentLines: string;
  laneLines: string;
  flatMinLine: string;
  accessorialsLine: string;
  portEvergladesSurcharge: number;
  detentionStandard: number;
  detentionFreeHours: number;
  detentionMin: number;
  detentionMax: number;
}

export type BaseContextBuilder = (inputs: BaseContextInputs) => string;

export interface LocaleMessages {
  verdict: VerdictMessages;
  rateCheck: RateCheckMessages;
  equipmentQuestion: EquipmentQuestionMessages;
  offTopic: OffTopicMessages;
  missingData: MissingDataMessages;
  outOfMarket: OutOfMarketMessages;
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
      fallbackRuta: 'Ruta solicitada',
      roundTripTag: 'redondo',
      oneWayTag: 'solo ida',
      estimatedMilesSuffix: ' · millas estimadas',
      lowConfidenceSuffix: ' · confianza baja',
      portSurchargeSuffix: { parts: [' · +$', ' recargo Port Everglades incluido'] },
      flatBasisLine: { parts: ['📐 Manda el mínimo del tramo ', ' · equivale a $', '/mi con estas millas · Equipo: ', ''] },
      rpmBasisLine: { parts: ['💰 Mercado: $', '–$', '/mi · Equipo: ', ''] },
      headerLine: { parts: ['', ' **', '** | Piso: ', ' | Objetivo: ', ''] },
      locationLine: { parts: ['📍 ', ' (', ')'] },
      confirmPrompt: '💡 Confirma origen, destino, millas y equipo para afinar la cifra.',
      askOfferPrompt: '¿Cuánto te ofrecen? Te digo si conviene.',
      adviceReject: { parts: ['Contraoferta ', '; no la dejes ir por menos de ', '.'] },
      adviceNegotiate: { parts: ['Ya cubre el piso; el margen hasta ', ' es lo que puedes empujar.'] },
      adviceAccept: 'Sobre objetivo; asegura el RC antes de que la reasignen.',
      posicionBajoPiso: 'bajo el piso',
      posicionEntre: 'entre piso y objetivo',
      posicionSobre: 'sobre objetivo',
      tallyLine: { parts: ['🧮 Ofrecen ', ' = $', '/mi (mín $', '/mi) → ', ', diferencia ', ' vs piso'] },
    },
    equipmentQuestion: {
      sizeIntro: '📦 Para darte un piso preciso necesito el tamaño del contenedor.',
      sizeQuestion: "¿Es un contenedor de 20' o de 40'?",
      missingIntro: '📦 Para calcular el piso necesito saber el equipo.',
      missingQuestion: "¿Con qué equipo lo mueves? (dry van, reefer, flatbed, step deck, drayage 20' o 40', power only)",
    },
    offTopic: {
      line1: '🚚 Solo manejo temas de freight: tarifas, rutas y operación de drayage en el sur de Florida.',
      line2: 'Pregúntame por tarifas, rutas u operación y te respondo al instante.',
    },
    missingData: {
      line1: '📊 Necesito más datos para calcular el piso y el objetivo.',
      line2: 'Dime origen, destino y millas (o si es "solo ida") — con eso te doy el número exacto.',
    },
    outOfMarket: {
      noRatesPrefix: '📊 No tengo tarifas de esa ruta',
      coverageLine: 'Mis datos cubren drayage del sur de Florida: PortMiami y Port Everglades.',
      confirmedRoutesLine: { parts: ['Rutas con tarifa confirmada: ', '.'] },
      askMoreLine: 'Si necesitas esa zona, dime las millas y te calculo con referencias de mercado, aclarando que no es una tarifa de tabla.',
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
    // Migrado ÍNTEGRO desde entry.ts (BASE_CONTEXT, chat-idioma-toggle Fase 2
    // T2.4) — mismo contenido semántico, sin traducir ni recortar, solo
    // reubicado y parametrizado por los insumos derivados que antes eran
    // interpolación directa de módulo.
    baseContext: (i) => `Eres TruckyAI, el asistente de inteligencia de mercado para dispatchers y carriers de drayage intermodal en el sur de Florida.

[Freight Dispatcher KB v${i.freightKbVersion}]

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

MERCADO DE REFERENCIA (dato del mercado, NO de una empresa en particular):
- Puertos del sur de Florida: PortMiami, Port Everglades (Fort Lauderdale)
- Corredores habituales desde esa zona: Tampa, Fort Myers/Naples, WPB, Fort Pierce, Pompano, Orlando, Jacksonville

EQUIPOS Y BENCHMARKS RPM (7 tipos — usa estos IDs exactos al extraer "equipo"):
${i.equipmentLines}

CATÁLOGO DE RUTAS DE REFERENCIA (millas REDONDO = ida + vuelta, salvo que el dispatcher diga "solo ida"/"one way"):
${i.laneLines}
- Port Everglades (Fort Lauderdale) se trata como zona base de Miami; agrega +$${i.portEvergladesSurcharge} de recargo de puerto — NO es una ruta aparte.

MÍNIMOS FLAT RATE (el piso real siempre es el MAYOR entre este mínimo y RPM mínimo del equipo × millas): ${i.flatMinLine}

DETENTION: único valor válido en toda respuesta — $${i.detentionStandard}/hr estándar tras ${i.detentionFreeHours}h libres (rango $${i.detentionMin}-$${i.detentionMax}/hr). NUNCA menciones otra cifra de detention.
ACCESSORIALS: ${i.accessorialsLine}

DEADHEAD: <20% millas cargadas=OK | 20-40%=Preocupante | >40%=Deal-breaker. Si deadhead >100mi, pedir $1.00-$1.50/mi adicional.

HOS: 11h conducción diaria | 14h on-duty | Pausa 30min tras 8h conduciendo | 70h/8días o 60h/7días.

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
      fallbackRuta: 'Requested route',
      roundTripTag: 'round trip',
      oneWayTag: 'one way',
      estimatedMilesSuffix: ' · estimated miles',
      lowConfidenceSuffix: ' · low confidence',
      portSurchargeSuffix: { parts: [' · +$', ' Port Everglades surcharge included'] },
      flatBasisLine: { parts: ['📐 The segment minimum ', ' applies · equals $', '/mi at this distance · Equipment: ', ''] },
      rpmBasisLine: { parts: ['💰 Market: $', '–$', '/mi · Equipment: ', ''] },
      headerLine: { parts: ['', ' **', '** | Floor: ', ' | Target: ', ''] },
      locationLine: { parts: ['📍 ', ' (', ')'] },
      confirmPrompt: '💡 Confirm origin, destination, miles, and equipment to refine the number.',
      askOfferPrompt: "How much are they offering you? I'll tell you if it's worth it.",
      adviceReject: { parts: ['Counter at ', "; don't let it go for less than ", '.'] },
      adviceNegotiate: { parts: ['It already covers the floor; the room up to ', ' is what you can push for.'] },
      adviceAccept: 'Above target; lock in the rate confirmation before it gets reassigned.',
      posicionBajoPiso: 'below the floor',
      posicionEntre: 'between floor and target',
      posicionSobre: 'above target',
      tallyLine: { parts: ["🧮 They're offering ", ' = $', '/mi (min $', '/mi) → ', ', difference ', ' vs floor'] },
    },
    equipmentQuestion: {
      sizeIntro: '📦 To give you an accurate floor I need the container size.',
      sizeQuestion: "Is it a 20' or 40' container?",
      missingIntro: '📦 To calculate the floor I need to know the equipment.',
      missingQuestion: "What equipment are you moving it with? (dry van, reefer, flatbed, step deck, drayage 20' or 40', power only)",
    },
    offTopic: {
      line1: '🚚 I only handle freight topics: rates, routes, and drayage operations in South Florida.',
      line2: "Ask me about rates, routes, or operations and I'll answer instantly.",
    },
    missingData: {
      line1: '📊 I need more data to calculate the floor and target.',
      line2: 'Tell me origin, destination, and miles (or if it\'s "one way") — with that I\'ll give you the exact number.',
    },
    outOfMarket: {
      noRatesPrefix: "📊 I don't have rates for that route",
      coverageLine: 'My data covers South Florida drayage: PortMiami and Port Everglades.',
      confirmedRoutesLine: { parts: ['Confirmed-rate routes: ', '.'] },
      askMoreLine: "If you need that area, tell me the miles and I'll calculate it using market references, noting it's not a table rate.",
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
    // KB (FIT, SFST, Pompano, WPB) — códigos internos del proyecto, no
    // vocabulario general de freight. Mismas 5 reglas críticas, mismo
    // guardarraíl de identidad, mismo contenido numérico (Design).
    baseContext: (i) => `You are TruckyAI, the market intelligence assistant for dispatchers and carriers of intermodal drayage in South Florida.

[Freight Dispatcher KB v${i.freightKbVersion}]

KB-SPECIFIC LOCATION CODES:
- FIT = Florida International Terminal (Medley/Hialeah, PortMiami area)
- SFST = South Florida Staging Terminal
- Pompano = Pompano Beach, FL
- WPB = West Palm Beach, FL

REFERENCE MARKET (market-wide data, NOT a specific company's rates):
- South Florida ports: PortMiami, Port Everglades (Fort Lauderdale)
- Common corridors from this area: Tampa, Fort Myers/Naples, WPB, Fort Pierce, Pompano, Orlando, Jacksonville

EQUIPMENT AND RPM BENCHMARKS (7 types — use these exact IDs when extracting "equipo"):
${i.equipmentLines}

REFERENCE LANE CATALOG (miles are ROUND TRIP = there and back, unless the dispatcher says "one way"):
${i.laneLines}
- Port Everglades (Fort Lauderdale) counts as a Miami-area base zone; add +$${i.portEvergladesSurcharge} port surcharge — it is NOT a separate lane.

FLAT RATE MINIMUMS (the real floor is always the GREATER of this minimum and the equipment's RPM minimum × miles): ${i.flatMinLine}

DETENTION: the only valid figure across the whole response — $${i.detentionStandard}/hr standard after ${i.detentionFreeHours}h free (range $${i.detentionMin}-$${i.detentionMax}/hr). NEVER mention a different detention figure.
ACCESSORIALS: ${i.accessorialsLine}

DEADHEAD: <20% loaded miles=OK | 20-40%=Concerning | >40%=Deal-breaker. If deadhead is over 100mi, ask for an extra $1.00-$1.50/mi.

HOS: 11h daily driving | 14h on-duty | 30min break after 8h driving | 70h/8days or 60h/7days.

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
