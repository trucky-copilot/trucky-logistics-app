import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { logAndSanitizeError } from '../../shared/safeError.ts';
import { isAppAdmin } from '../../shared/adminAccess.ts';

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
          flatbed: { type: "number", description: "Tarifa RPM para Flatbed" },
          container: { type: "number", description: "Tarifa RPM para Contenedor / Drayage" }
        },
        required: ["state_code"]
      }
    }
  },
  required: ["states"]
};

export default async function adminUploadStateData(req: Request, ctx: any) {
  try {
    const base44 = createClientFromRequest(req);
    let user;
    try {
      user = await base44.auth.me();
    } catch (e) {
      // ignore
    }
    // Solo administradores: rol "admin" en Base44 y correo en shared/adminAccess.ts.
    if (!isAppAdmin(user)) {
      return new Response('Unauthorized', { status: 403 });
    }

    const body = await req.json();
    const { textData } = body;

    // F6-01: esta función ya NO escribe tarifas de contenedor (ContainerRoute).
    // Las tarifas drayage se cargan en Panel Admin → Tarifas drayage
    // (adminSaveRates: vista previa, UPSERT e historial). Aquí solo queda el
    // análisis con IA de tarifas por milla por estado (StateMarketData).
    if (!textData || !String(textData).trim()) {
      return new Response('Missing textData', { status: 400 });
    }

    // Si hay texto disponible, extraer con IA tarifas promedio por estado (DAT / Market report)
    let statesCount = 0;
    if (textData && textData.trim()) {
      // Limitar el texto a un tamaño razonable para el LLM para evitar exceder tokens
      const truncatedText = textData.length > 25000 ? textData.slice(0, 25000) : textData;

      const prompt = `
        Eres un analista de tarifas de transporte de carga. 
        Se te proporciona el siguiente texto extraído de un reporte o tabla de mercado (Excel, PDF, imagen o texto libre).
        Por favor, extrae las tarifas promedio por milla (RPM) para cada estado que encuentres.
        IMPORTANTE: Si el documento menciona promedios "Nacionales" (National Average), extráelos asignándoles el state_code "US".
        Clasifícalas en dry_van, reefer, flatbed y container (si se menciona contenedor o drayage).
        Si algún dato falta, devuélvelo como nulo, pero no omitas el estado si tienes datos de al menos un equipo.
        
        TEXTO A ANALIZAR:
        ${truncatedText}
      `;

      try {
        const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt,
          response_json_schema: SCHEMA
        });

        if (result && result.states && Array.isArray(result.states)) {
          for (const s of result.states) {
            if (!s.state_code || s.state_code.length !== 2) continue;
            const code = s.state_code.toUpperCase();
            
            const existing = await base44.entities.StateMarketData.filter({ state_code: code });
            if (existing.length > 0) {
              await base44.entities.StateMarketData.update(existing[0].id, {
                dry_van: s.dry_van ?? existing[0].dry_van,
                reefer: s.reefer ?? existing[0].reefer,
                flatbed: s.flatbed ?? existing[0].flatbed,
                container: s.container ?? existing[0].container
              });
            } else {
              await base44.entities.StateMarketData.create({
                state_code: code,
                dry_van: s.dry_van ?? null,
                reefer: s.reefer ?? null,
                flatbed: s.flatbed ?? null,
                container: s.container ?? null
              });
            }
            statesCount++;
          }
        }
      } catch (err) {
        console.warn("Aviso: InvokeLLM no procesó estados o el texto era puramente rutas de contenedor:", err);
      }
    }

    return Response.json({
      success: true,
      statesParsed: statesCount,
      containerRoutesParsed: 0
    });
  } catch (e: any) {
    return new Response(JSON.stringify(logAndSanitizeError('adminUploadStateData', e)), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}