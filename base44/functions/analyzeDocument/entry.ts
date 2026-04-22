import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYSTEM_PROMPT = `Eres TruckyAI Document Analyzer, especialista en análisis de rate confirmations y contratos de transporte en el mercado de camiones de Estados Unidos.

Tu tarea es analizar rate confirmations y detectar cláusulas problemáticas para transportistas.

CATEGORÍAS A ANALIZAR:
1. TÉRMINOS DE PAGO - Plazo de pago, factoring, deducciones
2. FECHAS Y TIEMPOS - Pickup/delivery windows imposibles, detention time
3. CLÁUSULAS DE PENALIDAD - Late fees, charge-backs, lumper fees escondidos
4. SEGUROS Y RESPONSABILIDAD - Cobertura requerida, cargo liability
5. CANCELACIÓN Y TONU - Políticas de cancelación, TONU fees
6. CONDICIONES GENERALES - Double brokering clauses, exclusividad, restricciones

FORMATO DE RESPUESTA (SIEMPRE en JSON válido):
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

Responde SOLO con el JSON válido, sin texto adicional, sin markdown, sin bloques de código.`;

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

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `${SYSTEM_PROMPT}\n\nAnaliza el siguiente rate confirmation y devuelve el análisis en JSON:\n\n---\n${documentText}\n---`,
      response_json_schema: {
        type: "object",
        properties: {
          resumen_ejecutivo: { type: "string" },
          semaforo_general: { type: "string" },
          categorias: { type: "array", items: { type: "object" } },
          alertas_criticas: { type: "array", items: { type: "string" } },
          puntos_negociar: { type: "array", items: { type: "string" } },
          veredicto: { type: "string" }
        }
      }
    });

    return Response.json({ analysis: result });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});