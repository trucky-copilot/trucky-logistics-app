import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { logAndSanitizeError } from '../../shared/safeError.ts';

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
    // Acceso por el rol de la plataforma (App Users), nunca por una lista de
    // correos escrita en el código.
    if (!user || user.role !== 'admin') {
      return new Response('Unauthorized', { status: 403 });
    }

    const body = await req.json();
    const { textData, containerRoutes } = body;

    if (!textData && (!containerRoutes || containerRoutes.length === 0)) {
      return new Response('Missing textData or containerRoutes', { status: 400 });
    }

    let containerRoutesCount = 0;

    // 1. Procesar rutas estructuradas de contenedores (Excel FL/TX u otras)
    if (Array.isArray(containerRoutes) && containerRoutes.length > 0) {
      let existingRoutes: any[] = [];
      try {
        existingRoutes = await base44.entities.ContainerRoute.filter({});
      } catch (err) {
        console.warn("Aviso: ContainerRoute aún no tiene registros o falló la consulta inicial:", err);
      }

      const routeMap = new Map<string, any>();
      for (const er of existingRoutes) {
        const key = `${(er.estado || '').toUpperCase()}_${(er.ciudad || '').trim().toLowerCase()}_${(er.mercado || '').trim().toLowerCase()}`;
        routeMap.set(key, er);
      }

      for (const cr of containerRoutes) {
        if (!cr.ciudad) continue;
        const estado = (cr.estado || 'FL').trim().toUpperCase();
        const ciudad = String(cr.ciudad).trim();
        const mercado = (cr.mercado || '').trim();
        const key = `${estado}_${ciudad.toLowerCase()}_${mercado.toLowerCase()}`;

        const payload = {
          route_key: `${estado}-${ciudad}${mercado ? '-' + mercado : ''}`.toUpperCase(),
          estado,
          ciudad,
          mercado: mercado || null,
          zona: cr.zona || null,
          grupo: cr.grupo || null,
          millas_ida: typeof cr.millas_ida === 'number' ? cr.millas_ida : (parseFloat(cr.millas_ida) || 0),
          precio_20: cr.precio_20 != null ? Number(cr.precio_20) : null,
          piso_20: cr.piso_20 != null ? Number(cr.piso_20) : null,
          precio_40: cr.precio_40 != null ? Number(cr.precio_40) : null,
          piso_40: cr.piso_40 != null ? Number(cr.piso_40) : null,
          precio_45: cr.precio_45 != null ? Number(cr.precio_45) : null,
          piso_45: cr.piso_45 != null ? Number(cr.piso_45) : null,
          precio_20_heavy: cr.precio_20_heavy != null ? Number(cr.precio_20_heavy) : null,
          piso_20_heavy: cr.piso_20_heavy != null ? Number(cr.piso_20_heavy) : null,
          fuente: cr.fuente || 'Excel Upload'
        };

        const existing = routeMap.get(key);
        if (existing) {
          await base44.entities.ContainerRoute.update(existing.id, payload);
        } else {
          const created = await base44.entities.ContainerRoute.create(payload);
          routeMap.set(key, created);
        }
        containerRoutesCount++;
      }
    }

    // 2. Si hay texto disponible, extraer con IA tarifas promedio por estado (DAT / Market report)
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
      containerRoutesParsed: containerRoutesCount
    });
  } catch (e: any) {
    return new Response(JSON.stringify(logAndSanitizeError('adminUploadStateData', e)), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}