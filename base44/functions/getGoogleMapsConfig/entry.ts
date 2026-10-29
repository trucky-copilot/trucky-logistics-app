import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

const ALLOWED_ORIGIN_SUFFIXES = ['.base44.app', '.base44.com', 'trucky.site'];
const ALLOWED_ORIGIN_PREFIXES = ['http://localhost:', 'http://127.0.0.1:'];

function corsHeadersFor(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowed =
    !!origin &&
    (ALLOWED_ORIGIN_SUFFIXES.some((suffix) => origin.endsWith(suffix)) ||
      ALLOWED_ORIGIN_PREFIXES.some((prefix) => origin.startsWith(prefix)));

  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

// Carga opcional del .env local en desarrollo
try {
  const envText = await Deno.readTextFile(new URL('./.env', import.meta.url));
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*)\s*$/);
    if (m) Deno.env.set(m[1], m[2].trim());
  }
} catch (_) {}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const base44 = createClientFromRequest(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch (_) {
      user = null;
    }

    if (!user) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    // Lee el secreto GOOGLE_MAPS_API_KEY configurado en Base44 Secrets o en el .env
    const apiKey =
      Deno.env.get('GOOGLE_MAPS_API_KEY') ||
      Deno.env.get('VITE_GOOGLE_MAPS_API_KEY') ||
      '';

    return new Response(
      JSON.stringify({
        apiKey,
        configured: Boolean(apiKey),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error?.message || 'Error al obtener configuración de Google Maps' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

