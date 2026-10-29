import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/**
 * getMapsConfig
 * Entrega al frontend la API Key de Google Maps JavaScript API leída del secreto
 * GOOGLE_MAPS_API_KEY de Base44 (en producción) o del base44/.env (en local).
 *
 * Seguridad:
 * - Solo responde a usuarios autenticados.
 * - CORS restringido a orígenes propios de la app.
 * - La key de Maps JS siempre termina visible en el navegador; su protección real
 *   es la restricción por referentes HTTP + restricción de API en Google Cloud.
 */
const ALLOWED_ORIGIN_SUFFIXES = ['.base44.app', '.base44.com'];
const ALLOWED_ORIGIN_PREFIXES = ['http://localhost:', 'http://127.0.0.1:'];

function corsHeadersFor(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowed =
    !!origin &&
    (ALLOWED_ORIGIN_SUFFIXES.some((s) => origin.endsWith(s)) ||
      ALLOWED_ORIGIN_PREFIXES.some((p) => origin.startsWith(p)));
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

// Fallback local: cargar base44/.env si existe (en producción se usa el secreto)
for (const rel of ['./.env', '../.env', '../../.env']) {
  try {
    const envText = await Deno.readTextFile(new URL(rel, import.meta.url));
    for (const line of envText.split('\n')) {
      const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*)\s*$/);
      if (m && !Deno.env.get(m[1])) Deno.env.set(m[1], m[2].trim());
    }
  } catch (_) {}
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY') || '';
    if (!apiKey) {
      return Response.json({ error: 'GOOGLE_MAPS_API_KEY no configurada' }, { status: 500, headers: corsHeaders });
    }

    return Response.json({ apiKey }, { headers: corsHeaders });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 500, headers: corsHeaders });
  }
});

