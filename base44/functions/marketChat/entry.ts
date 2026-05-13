import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─────────────────────────────────────────────────────────────────────────────
// FREIGHT DISPATCHER KNOWLEDGE — Runtime constants (inline para backend Deno)
// Fuente canónica: lib/freight/freightKnowledgeBase.js (frontend)
// Esta versión es un extracto optimizado para el prompt del backend.
// ─────────────────────────────────────────────────────────────────────────────
const FREIGHT_KB_VERSION = '1.0.0';

const FREIGHT_RUNTIME = {
  rpm_benchmarks: [
    { equipment: "53' Dry Van",           min: 2.00, good: 2.50, excellent: 3.00 },
    { equipment: 'Reefer',                min: 2.30, good: 2.80, excellent: 3.50 },
    { equipment: 'Flatbed',               min: 2.50, good: 3.00, excellent: 3.75 },
    { equipment: 'Step Deck',             min: 2.75, good: 3.25, excellent: 4.00 },
    { equipment: "Drayage 20'",           min: 2.75, good: 3.50, excellent: 5.00 },
    { equipment: "Drayage 40'",           min: 2.50, good: 3.25, excellent: 4.50 },
  ],
  flat_minimums: [
    { range: '<50 mi',    min: 400  },
    { range: '50–100 mi', min: 500  },
    { range: '100–200',   min: 650  },
    { range: '200–400',   min: 900  },
    { range: '400–600',   min: 1400 },
    { range: '600–800',   min: 1800 },
    { range: '800+ mi',   min: 2400 },
  ],
  deadhead: {
    acceptable: 20,    // % máximo de millas cargadas
    concerning: 40,
    compensation: '$1.00–$1.50/mi si deadhead > 100 mi',
  },
  accessorials: [
    { service: 'Detention', rate: '$50–$100/hr (estándar $75/hr, tras 2 hrs libres)' },
    { service: 'TONU', rate: '$150–$300' },
    { service: 'Layover', rate: '$150–$300/noche' },
    { service: 'Pre-Pull', rate: '$100–$200' },
    { service: 'Chassis split', rate: '$75/día' },
    { service: 'Storage', rate: '$75–$150/día' },
  ],
  hos: {
    daily_driving: '11h tras 10h off-duty',
    daily_on_duty: '14h total',
    weekly: '70h en 8 días / 60h en 7 días',
    break: '30 min tras 8h conduciendo',
  },
};

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
- detention = cobro por espera excesiva en puerto o cliente (normalmente $65-$100/hr)
- per diem = cargo diario por uso de contenedor del naviero
- demurrage = cargo por contenedor que sigue en puerto después de free days
- void check = cheque anulado para configurar pago ACH/EFT con broker
- TONU = Truck Order Not Used (cuando el broker cancela después de confirmar)

EMPRESA:
- Larcofer USA, Miami FL — Drayage intermodal
- Puertos: PortMiami, Port Everglades (Fort Lauderdale)
- Rutas principales: Tampa, Naples/Fort Myers, WPB, Fort Pierce, Pompano, Orlando, Jacksonville

TARIFAS DE REFERENCIA (REDONDO = ida + vuelta, salvo que el usuario diga solo ida):
- Miami ↔ Tampa: ~540 millas redondo | mercado: $2.80-$3.40/mi | mínimo: $1,512 redondo
- Miami ↔ Fort Myers/Naples: ~240 millas redondo | mercado: $2.90-$3.50/mi | mínimo: $700 redondo
- Miami ↔ WPB: ~136 millas redondo | mercado: $3.00-$4.00/mi | mínimo: $408 redondo
- Miami ↔ Fort Pierce: ~230 millas redondo | mercado: $2.90-$3.40/mi | mínimo: $670 redondo
- Miami ↔ Orlando: ~470 millas redondo | mercado: $2.85-$3.30/mi | mínimo: $1,340 redondo
- Miami ↔ Jacksonville: ~680 millas redondo | mercado: $2.75-$3.20/mi | mínimo: $1,870 redondo
- Miami ↔ Pompano: ~70 millas redondo | mercado: $3.50-$5.00/mi | mínimo: $245 redondo
- Port Everglades: sumar +$50 recargo de puerto
- Diesel > $5.00: sumar fuel surcharge (5-8% del flete)

CONTEXTO DEL MERCADO:
- Quickload: $2.20/milla (casi siempre pérdida — break-even está en ~$2.70-$2.80/mi)
- Tarifa rentable objetivo: $3.00+/milla

BENCHMARKS RPM (2024-2025):
- 53' Dry Van: Mín $2.00 | Bueno $2.50 | Excelente $3.00+/mi
- Reefer: Mín $2.30 | Bueno $2.80 | Excelente $3.50+/mi
- Flatbed: Mín $2.50 | Bueno $3.00 | Excelente $3.75+/mi
- Drayage 20': Mín $2.75 | Bueno $3.50 | Excelente $5.00+/mi
- Drayage 40': Mín $2.50 | Bueno $3.25 | Excelente $4.50+/mi

MÍNIMOS FLAT RATE: <50mi=$400 | 50-100mi=$500 | 100-200mi=$650 | 200-400mi=$900 | 400-600mi=$1,400 | 600-800mi=$1,800 | 800+mi=$2,400+
REGLA: usar SIEMPRE el MAYOR entre fórmula RPM y flat mínimo.

DEADHEAD: <20% millas cargadas=OK | 20-40%=Preocupante | >40%=Deal-breaker. Si deadhead >100mi, pedir $1.00-$1.50/mi adicional.

ACCESSORIALS (nunca en all-in sin negociar): Detention $75/hr (tras 2h libres) | TONU $150-$300 | Pre-pull $100-$200 | Chassis split $75/día | Storage $75-$150/día

HOS: 11h conducción diaria | 14h on-duty | Pausa 30min tras 8h | 70h/8días o 60h/7días

REGLAS CRÍTICAS DE RESPUESTA:
1. Respuestas MUY CORTAS — máximo 5 líneas. El dispatcher no quiere leer párrafos.
2. Formato OBLIGATORIO para consultas de tarifa:
   [EMOJI VEREDICTO] **VEREDICTO** | Mínimo: $XXX | Objetivo: $XXX
   📍 [origen] → [destino] (~XXX mi redondo)
   💰 Tarifa de mercado: $X.XX - $X.XX/mi
   💡 [consejo táctico en UNA oración]
   ¿Cuánto te ofrecen? Te digo si conviene.
3. Veredicto = 🟢 ACEPTAR / 🟡 NEGOCIAR / 🔴 RECHAZAR
4. NUNCA sugerir "busca carga de regreso" — eso lo maneja el dispatcher, no el broker.
5. SIEMPRE calcular millas REDONDAS (ida + vuelta) salvo que el usuario diga "solo ida" o "one way".
6. SIEMPRE terminar con: "¿Cuánto te ofrecen? Te digo si conviene."
7. Para preguntas que no son de ruta, responde en máximo 3 líneas y termina con la pregunta.`;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { messages, costConfig } = await req.json();

    let systemContext = BASE_CONTEXT;
    if (costConfig && costConfig.costo_por_milla) {
      systemContext += `\n\nCOSTOS PERSONALIZADOS DEL USUARIO:
- Diésel: $${costConfig.diesel_precio}/gal | MPG: ${costConfig.mpg}
- Costo/milla: $${costConfig.costo_por_milla.toFixed(2)} | Break-even: $${costConfig.tarifa_break_even ? costConfig.tarifa_break_even.toFixed(2) : 'N/A'}/mi
- Objetivo: $${costConfig.tarifa_objetivo}/mi
→ Usa estos valores para todos los cálculos de rentabilidad.`;
    }

    const conversationHistory = messages.map(m =>
      `${m.role === 'user' ? 'Dispatcher' : 'TruckyAI'}: ${m.content}`
    ).join('\n\n');

    const fullPrompt = `${systemContext}\n\n=== CONVERSACIÓN ===\n${conversationHistory}\n\nTruckyAI:`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt: fullPrompt
    });

    return Response.json({ content: response });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});