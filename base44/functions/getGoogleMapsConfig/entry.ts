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

function normalizeForMap(loc: string): string {
  if (!loc || typeof loc !== 'string') return '';
  const norm = loc.trim();
  const lower = norm.toLowerCase();
  if (lower === 'port' || lower === 'puerto' || lower === 'port, fl' || lower === 'puerto, fl') {
    return 'Port Everglades, Fort Lauderdale, FL';
  }
  if (lower.includes('mega rail') || lower.includes('garden city') || lower.includes('savannah port')) {
    return 'Georgia Ports Authority - Garden City Terminal, Savannah, GA';
  }
  if (lower.includes('port tampa bay')) return 'Port Tampa Bay, Tampa, FL';
  if (lower.includes('port everglades') || lower.includes('pev')) return 'Port Everglades, Fort Lauderdale, FL';
  if (lower.includes('pomtoc') || lower.includes('sfct') || lower.includes('port miami') || lower.includes('portmiami')) {
    return 'Port of Miami, Miami, FL';
  }
  return `${norm}, USA`;
}

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

    let body: Record<string, any> = {};
    try {
      body = await req.json();
    } catch (_) {
      body = {};
    }

    const apiKey =
      Deno.env.get('GOOGLE_MAPS_API_KEY') ||
      Deno.env.get('VITE_GOOGLE_MAPS_API_KEY') ||
      '';

    // Si se envían ubicaciones de cargas, geocodificarlas desde el servidor con GOOGLE_MAPS_API_KEY
    const rawAddresses = Array.isArray(body.addresses)
      ? body.addresses.slice(0, 16).filter((a) => typeof a === 'string' && a.trim())
      : [];

    const geocoded: Record<string, { lat: number; lng: number; formattedAddress?: string }> = {};

    if (apiKey && rawAddresses.length > 0) {
      await Promise.all(
        rawAddresses.map(async (addr: string) => {
          const cleanKey = addr.trim().toLowerCase();
          try {
            const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
            url.searchParams.set('address', normalizeForMap(addr));
            url.searchParams.set('key', apiKey);
            const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
            if (res.ok) {
              const data = await res.json();
              const loc = data?.results?.[0]?.geometry?.location;
              if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
                geocoded[cleanKey] = {
                  lat: loc.lat,
                  lng: loc.lng,
                  formattedAddress: data.results[0].formatted_address,
                };
              }
            }
          } catch (_) {
            // continuar con las demás direcciones
          }
        })
      );
    }

    return new Response(
      JSON.stringify({
        apiKey,
        configured: Boolean(apiKey),
        geocoded,
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
