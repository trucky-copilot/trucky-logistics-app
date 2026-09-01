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

export interface LocaleMessages extends CatalogTree {
  verdict: VerdictMessages;
  rateCheck: RateCheckMessages;
  equipmentQuestion: EquipmentQuestionMessages;
  offTopic: OffTopicMessages;
  missingData: MissingDataMessages;
  outOfMarket: OutOfMarketMessages;
  safeFallback: SafeFallbackMessages;
  units: UnitsMessages;
  // Placeholder hasta Fase 2 (T2.4/T2.5): BASE_CONTEXT localizado.
  baseContext: CatalogTree;
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
    // Placeholder para Fase 2 (T2.2): el fix de ACCESSORIALS.unit todavía no
    // toca entry.ts en esta fase. La clave existe para que la paridad de
    // árbol de claves (T1.1) ya quede fija desde ahora.
    units: {
      perDay: '',
    },
    // Placeholder para Fase 2 (T2.4/T2.5): BASE_CONTEXT localizado vive en
    // entry.ts hoy; se traslada acá recién en la fase que toca ese archivo.
    baseContext: {},
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
      perDay: '',
    },
    baseContext: {},
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
