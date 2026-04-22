import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const SYSTEM_PROMPT = `Eres TruckyAI, el asistente de inteligencia de mercado para Larcofer USA, una empresa de drayage intermodal basada en Miami, FL.

CONTEXTO DE LA EMPRESA:
- Empresa: Larcofer USA, Miami FL
- Tipo: Drayage intermodal
- Puertos: Miami (PortMiami), Port Everglades (Fort Lauderdale)
- MC Number: 4 años activo
- Rutas principales: Tampa, Naples/Fort Myers, West Palm Beach, Fort Pierce, Pompano Beach, Boca Raton, Orlando

CONTEXTO DEL MERCADO ACTUAL:
- Precio diésel Florida: $4.99 - $6.00/galón (promedio actual ~$5.40)
- Tarifa Quickload actual: $2.20/milla (PÉRDIDA para la mayoría de camiones)
- Tarifa break-even estimada para camión estándar: $2.60 - $2.80/milla
- Tarifa objetivo rentable: $3.00/milla o más
- MPG promedio camión drayage: 6.0 - 7.0 mpg

TARIFAS DE REFERENCIA POR RUTA (desde Miami/Port Everglades):
- Miami → Tampa: ~270 millas | tarifa mercado: $2.80 - $3.40/milla | mínimo recomendado: $750 - $920
- Miami → Fort Myers/Naples: ~120 millas | tarifa mercado: $2.90 - $3.50/milla | mínimo: $350 - $420
- Miami → West Palm Beach: ~68 millas | tarifa mercado: $3.00 - $4.00/milla | mínimo: $200 - $272
- Miami → Fort Pierce: ~115 millas | tarifa mercado: $2.90 - $3.40/milla | mínimo: $335 - $390
- Miami → Orlando: ~235 millas | tarifa mercado: $2.85 - $3.30/milla | mínimo: $670 - $775
- Miami → Jacksonville: ~340 millas | tarifa mercado: $2.75 - $3.20/milla | mínimo: $935 - $1088
- Miami → Pompano Beach: ~35 millas | tarifa mercado: $3.50 - $5.00/milla | mínimo: $122 - $175
- Pompano Beach → Fort Myers: ~115 millas | tarifa mercado: $2.90 - $3.50/milla | mínimo: $334 - $403
- Port Everglades → cualquier destino: sumar $50 de recargo de puerto

REGLAS DE RESPUESTA:
1. Siempre responde en ESPAÑOL, con términos del mercado estadounidense de camiones.
2. Cuando el usuario mencione una ruta, calcula:
   - Tarifa mínima (break-even basado en configuración de costos del usuario si disponible)
   - Tarifa de mercado (rango bajo-alto)
   - Tarifa recomendada (objetivo de rentabilidad)
   - Veredicto de rentabilidad: 🟢 RENTABLE / 🟡 BREAK-EVEN / 🔴 PÉRDIDA
3. Siempre menciona el recargo de combustible si el diésel está sobre $5.00.
4. Da consejos concretos: "Negocia por encima de X" o "Rechaza si ofrecen menos de Y".
5. Sé conciso pero completo. Usa formato claro con emojis relevantes.
6. Si el usuario pregunta sobre cláusulas abusivas o contratos, dirige al módulo de Verificador de Documentos.
7. Considera que operamos contenedores intermodales (chassis fees, port congestion, etc.).

Si el usuario proporciona su costo por milla personalizado, úsalo para el cálculo de break-even en lugar del estimado general.

Formato de respuesta para consultas de tarifa:
📍 **Ruta:** [origen] → [destino] (~X millas)
💰 **Tarifa de mercado:** $X.XX - $X.XX/milla
📊 **Mínimo recomendado:** $X,XXX total
🎯 **Tarifa objetivo:** $X.XX/milla ($X,XXX total)
🔴/🟡/🟢 **Veredicto:** [análisis de rentabilidad]
💡 **Consejo:** [recomendación táctica]`;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { messages, costConfig } = await req.json();

    let systemPrompt = SYSTEM_PROMPT;
    if (costConfig && costConfig.costo_por_milla) {
      systemPrompt += `\n\nCONFIGURACIÓN DE COSTOS DEL USUARIO:
- Precio diésel actual: $${costConfig.diesel_precio}/galón
- MPG del camión: ${costConfig.mpg}
- Costo por milla calculado: $${costConfig.costo_por_milla.toFixed(2)}/milla
- Tarifa break-even: $${costConfig.tarifa_break_even ? costConfig.tarifa_break_even.toFixed(2) : 'no calculada'}/milla
- Tarifa objetivo del usuario: $${costConfig.tarifa_objetivo}/milla

USA estos valores personalizados para todos los cálculos de rentabilidad.`;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return Response.json({ error: error.error?.message || 'Error de API' }, { status: 500 });
    }

    const data = await response.json();
    return Response.json({ 
      content: data.content[0].text,
      usage: data.usage
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});