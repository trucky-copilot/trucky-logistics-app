import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

const SCHEMA = {
  type: "object",
  properties: {
    states: {
      type: "array",
      items: {
        type: "object",
        properties: {
          state_code: { type: "string", description: "Código del estado a 2 letras (ej. TX, FL)" },
          dry_van: { type: "number", description: "Tarifa RPM para Dry Van" },
          reefer: { type: "number", description: "Tarifa RPM para Reefer" },
          flatbed: { type: "number", description: "Tarifa RPM para Flatbed" }
        },
        required: ["state_code"]
      }
    }
  },
  required: ["states"]
};

export default async function adminUploadStateData(req: Request, ctx: any) {
  try {
    const user = await ctx.auth.getUser();
    if (!user || (user.email !== 'luis.bermudez@ogma.com.co' && user.email !== 'luis.bermudez@ogm.com.co')) {
      return new Response('Unauthorized', { status: 403 });
    }

    const body = await req.json();
    const { textData } = body;

    if (!textData) {
      return new Response('Missing textData', { status: 400 });
    }

    const prompt = `
      Eres un analista de tarifas de transporte de carga. 
      Se te proporciona el siguiente texto extraído de un reporte (PDF, imagen o texto libre).
      Por favor, extrae las tarifas promedio por milla (RPM) para cada estado que encuentres.
      Clasifícalas en dry_van, reefer y flatbed.
      Si algún dato falta, devuélvelo como nulo, pero no omitas el estado si tienes datos de al menos un equipo.
      
      TEXTO A ANALIZAR:
      ${textData}
    `;

    const base44 = createClientFromRequest(req);
    let result;
    try {
      result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: SCHEMA
      });
    } catch (error) {
      console.error("Error en InvokeLLM:", error);
      return new Response('Error procesando el documento con IA: ' + String(error), { status: 500 });
    }

    if (!result || !result.states || !Array.isArray(result.states)) {
      return new Response('La IA no pudo interpretar el documento.', { status: 422 });
    }

    // Guardamos o actualizamos cada estado
    for (const s of result.states) {
      if (!s.state_code || s.state_code.length !== 2) continue;
      const code = s.state_code.toUpperCase();
      
      const existing = await base44.entities.StateMarketData.filter({ state_code: code });
      if (existing.length > 0) {
        await base44.entities.StateMarketData.update(existing[0].id, {
          dry_van: s.dry_van ?? existing[0].dry_van,
          reefer: s.reefer ?? existing[0].reefer,
          flatbed: s.flatbed ?? existing[0].flatbed
        });
      } else {
        await base44.entities.StateMarketData.create({
          state_code: code,
          dry_van: s.dry_van ?? null,
          reefer: s.reefer ?? null,
          flatbed: s.flatbed ?? null
        });
      }
    }

    return Response.json({ success: true, statesParsed: result.states.length });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e), stack: e.stack }), { status: 500 });
  }
}
