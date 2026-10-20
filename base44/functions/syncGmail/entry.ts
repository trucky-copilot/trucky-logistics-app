import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { ImapFlow } from 'npm:imapflow';
import { simpleParser } from 'npm:mailparser';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Carga robusta de variables de entorno locales (.env)
async function loadEnv() {
  const envUrls = [
    new URL('./.env', import.meta.url),
    new URL('../../.env', import.meta.url),
    new URL('../../../.env', import.meta.url),
  ];

  for (const url of envUrls) {
    try {
      const text = await Deno.readTextFile(url);
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*)\s*$/);
        if (m && !Deno.env.get(m[1])) {
          Deno.env.set(m[1], m[2].trim());
        }
      }
    } catch (_) {
      // Ignorar archivos que no existen en este path
    }
  }
}

await loadEnv();

// Palabras clave que confirman contexto de logística y transporte
const LOGISTICS_KEYWORDS = [
  'load', 'freight', 'rate', 'lane', 'reefer', 'dry van', 'drayage', 'flatbed',
  'container', 'chassis', 'detention', 'layover', 'tonu', 'bol', 'bill of lading',
  'rate confirmation', 'rate con', 'delivery order', 'proof of delivery', 'pod',
  'lumper', 'carrier', 'broker', 'dispatcher', 'dispatch', 'pickup', 'delivery',
  'origin', 'destination', 'mc#', 'mc number', 'dot#', 'factoring', 'quickpay',
  'invoice', 'settlement', 'deadhead', 'all-in', 'rpm', 'flete', 'carga', 'camion',
  'remolque', 'orden de entrega', 'carta porte'
];

// Palabras clave personales, familiares, ocio o no laborales para exclusión
const EXCLUSION_KEYWORDS = [
  'mamá', 'mama', 'papá', 'papa', 'hijo', 'hija', 'familia', 'abuelo', 'abuela',
  'netflix', 'spotify', 'steam', 'playstation', 'xbox', 'disney+', 'prime video',
  'hbo', 'twitch', 'uber eats', 'rappi', 'pedidosya', 'casino', 'lotería',
  'reserva de hotel', 'vuelo vacacional', 'cena familiar'
];

/**
 * Clasificador inteligente de correos:
 * Discrimina correos operativos del transporte de mensajes personales o spam.
 */
function classifyEmail(subject: string, text: string) {
  const content = `${subject || ''} ${text || ''}`.toLowerCase();

  const tieneExclusion = EXCLUSION_KEYWORDS.some(k => content.includes(k));
  const matchesLogistics = LOGISTICS_KEYWORDS.filter(k => content.includes(k));

  // Si tiene términos de ocio/familia y nulo contexto logístico -> descartar
  if (tieneExclusion && matchesLogistics.length < 2) {
    return { es_logistico: false, categoria: 'general' };
  }

  // Si tiene palabras clave logísticas
  if (matchesLogistics.length > 0) {
    let categoria = 'cargas';
    if (content.includes('broker') || content.includes('packet') || content.includes('setup') || content.includes('acuerdo') || content.includes('rate') || content.includes('quote')) {
      categoria = 'brokers';
    }
    return { es_logistico: true, categoria };
  }

  // Por defecto, sin indicadores logísticos, no debe aparecer en la bandeja operativa
  return { es_logistico: false, categoria: 'general' };
}

export default async function syncGmail(req: Request, ctx: any) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let client: ImapFlow | null = null;

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { organization_id, profile_id, limit = 20, gmailUser: reqGmailUser } = body;

    const gmailUser = (reqGmailUser && String(reqGmailUser).trim()) || Deno.env.get("GMAIL_USER");
    const rawPass = Deno.env.get("GMAIL_APP_PASSWORD");
    const gmailPass = rawPass ? rawPass.replace(/\s+/g, '') : null;

    if (!gmailUser || !gmailPass) {
      return new Response(
        JSON.stringify({ error: "Credenciales de Gmail no configuradas en el entorno (GMAIL_USER, GMAIL_APP_PASSWORD)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    client = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: {
        user: gmailUser,
        pass: gmailPass,
      },
      logger: false,
    });

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    const syncedEmails = [];
    let nuevosGuardados = 0;
    let omitidosNoLogisticos = 0;

    try {
      const status = await client.status('INBOX', { messages: true });
      const totalMessages = status.messages || 0;

      if (totalMessages > 0) {
        // Consultar los correos más recientes (hasta el límite pedido, por defecto 20)
        const fetchCount = Math.min(limit, totalMessages);
        const startSeq = Math.max(1, totalMessages - fetchCount + 1);
        const range = `${startSeq}:${totalMessages}`;

        // Obtener los correos existentes en Base44 para deduplicar
        const existingEmails = await base44.entities.Email.filter();
        const existingSet = new Set(
          existingEmails.map((e: any) => `${e.remitente_email}__${e.asunto}__${e.fecha?.slice(0, 16)}`)
        );

        for await (const msg of client.fetch(range, { source: true, envelope: true })) {
          if (!msg.source) continue;

          const parsed = await simpleParser(msg.source);
          const subject = parsed.subject || '(Sin asunto)';
          const fromAddress = parsed.from?.value?.[0]?.address || 'desconocido@correo.com';
          const fromName = parsed.from?.value?.[0]?.name || fromAddress.split('@')[0];
          const toAddress = parsed.to?.value?.[0]?.address || gmailUser;
          const date = parsed.date ? parsed.date.toISOString() : new Date().toISOString();
          const plainText = parsed.text || '';
          const snippet = plainText.slice(0, 180).replace(/\r?\n+/g, ' ').trim();

          // Deduplicación contra la base de datos
          const dedupeKey = `${fromAddress}__${subject}__${date.slice(0, 16)}`;
          if (existingSet.has(dedupeKey)) {
            continue;
          }

          // Aplicar Filtro Inteligente Anti-Ruido
          const { es_logistico, categoria } = classifyEmail(subject, plainText);

          if (!es_logistico) {
            omitidosNoLogisticos++;
            continue; // Se excluye de la bandeja de entrada según el requisito
          }

          // Guardar el correo logístico verificado en Base44
          const nuevoRegistro = await base44.entities.Email.create({
            organization_id: organization_id || null,
            profile_id: profile_id || null,
            remitente_nombre: fromName,
            remitente_email: fromAddress,
            destinatario_email: toAddress,
            asunto: subject,
            cuerpo: plainText || snippet,
            snippet: snippet || subject,
            fecha: date,
            leido: false, // Inicia como no leído (punto azul)
            destacado: false,
            categoria,
            es_logistico: true,
            tipo_flujo: 'inbox',
          });

          syncedEmails.push(nuevoRegistro);
          nuevosGuardados++;
          existingSet.add(dedupeKey);
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();

    return new Response(
      JSON.stringify({
        success: true,
        nuevosGuardados,
        omitidosNoLogisticos,
        totalEncontrados: syncedEmails.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    if (client) {
      try { await client.logout(); } catch (_) {}
    }
    console.error("Error en syncGmail:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Error al sincronizar con Gmail" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
