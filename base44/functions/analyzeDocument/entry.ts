import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const SYSTEM_PROMPT = `Eres TruckyAI Document Analyzer, especialista en análisis de rate confirmations y contratos de transporte en el mercado de camiones de Estados Unidos.

Tu tarea es analizar rate confirmations / red confirmations y detectar cláusulas problemáticas para transportistas.

CATEGORÍAS A ANALIZAR:

1. **TÉRMINOS DE PAGO** - Plazo de pago, factoring, deducciones
2. **FECHAS Y TIEMPOS** - Pickup/delivery windows imposibles, detention time
3. **CLÁUSULAS DE PENALIDAD** - Late fees, charge-backs, lumper fees escondidos
4. **SEGUROS Y RESPONSABILIDAD** - Cobertura requerida, cargo liability
5. **CANCELACIÓN Y TONU** - Políticas de cancelación, TONU fees
6. **CONDICIONES GENERALES** - Double brokering clauses, exclusividad, restricciones

CASOS DE REFERENCIA (contexto Larcofer USA):
- El caso "Ana/Shan Import": tuvieron cláusulas de penalización de $500/hr por detention time que no era reconocido, y ventana de entrega de 2 horas en destino con penalidad de $250 por retraso.
- Brokers problemáticos en Florida: deducciones automáticas sin documentación, factoring sin consentimiento del carrier.

FORMATO DE RESPUESTA (SIEMPRE en JSON):
{
  "resumen_ejecutivo": "string - 2-3 oraciones del veredicto general",
  "semaforo_general": "verde" | "amarillo" | "rojo",
  "categorias": [
    {
      "categoria": "nombre de categoría",
      "semaforo": "verde" | "amarillo" | "rojo",
      "hallazgos": ["hallazgo 1", "hallazgo 2"],
      "clausula_texto": "texto exacto del documento si aplica",
      "recomendacion": "qué hacer al respecto"
    }
  ],
  "alertas_criticas": ["lista de las alertas más urgentes"],
  "puntos_negociar": ["lista de puntos a negociar antes de firmar"],
  "veredicto": "FIRMAR" | "NEGOCIAR" | "RECHAZAR"
}

Responde SOLO con el JSON válido, sin texto adicional.`;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { documentText } = await req.json();

    if (!documentText || documentText.trim().length < 10) {
      return Response.json({ error: 'Texto del documento vacío o muy corto' }, { status: 400 });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Analiza el siguiente rate confirmation / documento de transporte y devuelve el análisis en JSON:\n\n---\n${documentText}\n---`
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return Response.json({ error: error.error?.message || 'Error de API' }, { status: 500 });
    }

    const data = await response.json();
    const rawText = data.content[0].text;
    
    let analysis;
    try {
      analysis = JSON.parse(rawText);
    } catch {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        return Response.json({ error: 'Error al parsear respuesta de IA' }, { status: 500 });
      }
    }

    return Response.json({ analysis });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});