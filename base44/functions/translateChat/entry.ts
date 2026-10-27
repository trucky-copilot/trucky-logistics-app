import {liveBillingGuard} from "./liveBillingGuard.ts";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

// CORS: antes se respondía con "Access-Control-Allow-Origin: *", lo que permitía
// que cualquier sitio web llamara a esta función desde el navegador de un
// visitante. Ahora solo se refleja el Origin cuando es un origen propio de la app.
const ALLOWED_ORIGIN_SUFFIXES = ['.base44.app', '.base44.com'];
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

// Límites de entrada: Google Translate se factura por carácter y por volumen.
const MAX_MESSAGES = 128;
const MAX_MESSAGE_CHARS = 5000;
const MAX_TOTAL_CHARS = 30000;

try {
  // Ahora lee su PROPIO archivo .env aislado
  const envText = await Deno.readTextFile(new URL('./.env', import.meta.url));
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*)\s*$/);
    if (m) Deno.env.set(m[1], m[2].trim()); 
  }
} catch (_) {}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Solo usuarios con sesión: sin esto cualquiera (humano o script) podía
    // consumir la cuota y la facturación de Google Cloud de la app.
    const base44 = createClientFromRequest(req);
    const billingDenied=await liveBillingGuard(req,base44);
    if(billingDenied)return billingDenied;
    let user;
    try {
      user = await base44.auth.me();
    } catch (_error) {
      user = null;
    }
    if (!user) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const { messages, targetLang } = await req.json();

    if (!messages || !Array.isArray(messages) || typeof targetLang !== 'string' || !targetLang) {
      throw new Error("Missing 'messages' array or 'targetLang'");
    }

    // Límites de tamaño de la petición (cantidad y longitud de los mensajes).
    if (messages.length > MAX_MESSAGES) {
      return new Response(JSON.stringify({ error: 'Demasiados mensajes en una sola petición' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const hasInvalidMessage = messages.some(
      (m) => !m || typeof m.content !== 'string' || m.content.length > MAX_MESSAGE_CHARS
    );
    if (hasInvalidMessage) {
      return new Response(JSON.stringify({ error: 'Mensaje vacío o demasiado largo' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    if (totalChars > MAX_TOTAL_CHARS) {
      return new Response(JSON.stringify({ error: 'La petición de traducción es demasiado grande' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    if (messages.length === 0) {
      return new Response(JSON.stringify({ messages: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // La clave vive como secreto de la app (Secrets), nunca escrita en el código.
    const apiKey = Deno.env.get("GOOGLE_TRANSLATE_API_KEY");

    if (!apiKey) {
      throw new Error("Missing GOOGLE_TRANSLATE_API_KEY environment variable");
    }

    // Extraer solo los textos para traducir
    const textsToTranslate = messages.map(m => m.content);

    // Llamar a Google Translate API (REST)
    const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
    const googleRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: textsToTranslate,
        target: targetLang,
        format: 'text' // Para mantener saltos de línea correctamente sin romper HTML, o usar 'html' si tienen formato. 'text' es más seguro para Markdown.
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!googleRes.ok) {
      const errorText = await googleRes.text();
      console.error("Google Translate Error:", errorText);
      throw new Error("Failed to translate with Google API");
    }

    const data = await googleRes.json();
    const translatedTexts = data.data.translations.map((t: any) => t.translatedText);

    // Reconstruir el array de mensajes con los textos traducidos
    const translatedMessages = messages.map((m, index) => ({
      ...m,
      content: translatedTexts[index]
    }));

    return new Response(JSON.stringify({ messages: translatedMessages }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    console.error("translateChat Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});