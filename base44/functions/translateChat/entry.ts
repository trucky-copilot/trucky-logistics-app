
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

try {
  // Ahora lee su PROPIO archivo .env aislado
  const envText = await Deno.readTextFile(new URL('./.env', import.meta.url));
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*)\s*$/);
    if (m) Deno.env.set(m[1], m[2].trim()); 
  }
} catch (_) {}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { messages, targetLang } = await req.json();

    if (!messages || !Array.isArray(messages) || !targetLang) {
      throw new Error("Missing 'messages' array or 'targetLang'");
    }

    // Usamos el fallback duro ya que Deno está bloqueando la lectura del archivo .env localmente
    const apiKey = Deno.env.get("GOOGLE_TRANSLATE_API_KEY") || "AIzaSyAjsTFlMbPi8QYwV6kbHXBGeTOv0ShYRS0";
    
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
      })
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
