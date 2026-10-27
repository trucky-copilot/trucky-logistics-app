import {liveBillingGuard} from "./liveBillingGuard.ts";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { ImapFlow } from 'npm:imapflow';
import { simpleParser } from 'npm:mailparser';

// CORS: solo se refleja el Origin cuando es un origen propio de la app (nunca
// el comodín "*"), igual que en translateChat y marketChat, para que un sitio
// ajeno no pueda llamar a esta función desde el navegador de un visitante.
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

// Palabras clave inequívocas de transporte de carga, fletes y corretaje
const MANDATORY_LOGISTICS_TERMS = [
  'load', 'loads', 'freight', 'freights', 'rate con', 'rate confirmation', 'bill of lading', 'bol',
  'flete', 'fletes', 'carga', 'cargas', 'reefer', 'dry van', 'flatbed', 'drayage', 'chassis',
  'detention', 'layover', 'tonu', 'lumper', 'carrier setup', 'broker packet', 'delivery order',
  'proof of delivery', 'pod', 'deadhead', 'all-in rate', 'rpm', 'tarifa de flete', 'orden de carga',
  'carta porte', 'remolque', 'trailer', 'tractor'
];

// Palabras clave generales del ecosistema de logística (requieren al menos un término clave o remitente especializado)
const LOGISTICS_KEYWORDS = [
  ...MANDATORY_LOGISTICS_TERMS,
  'carrier', 'carriers', 'broker', 'brokers', 'dispatcher', 'dispatchers', 'dispatch',
  'pickup', 'delivery', 'lane', 'lanes', 'container', 'containers', 'mc#', 'mc number', 'dot#',
  'factoring', 'quickpay', 'camion', 'camiones', 'flota', 'flotas', 'trucky', 'cotizacion flete'
];

// Palabras clave personales, ocio, marketing o servicios corporativos ajenos al flete
const EXCLUSION_KEYWORDS = [
  'mamá', 'mama', 'papá', 'papa', 'hijo', 'hija', 'familia', 'abuelo', 'abuela',
  'netflix', 'spotify', 'steam', 'playstation', 'xbox', 'disney+', 'prime video',
  'hbo', 'twitch', 'uber', 'rappi', 'pedidosya', 'casino', 'lotería', 'didi',
  'reserva de hotel', 'vuelo vacacional', 'cena familiar', 'airbnb', 'booking.com',
  'alerta de seguridad', 'security alert', 'código de verificación', 'verification code',
  'recuperado correctamente', 'ha compartido algunos datos', 'google workspace',
  'política de privacidad', 'privacy policy', 'actualización de términos', 'terms of service',
  'newsletter', 'boletín', 'resumen semanal', 'weekly digest', 'promoción', 'oferta especial',
  'descuento', 'factura de compra', 'recibo de pago', 'order confirmation', 'amazon.com',
  'mercadolibre', 'ebay', 'aliexpress', 'linkedin', 'facebook', 'instagram', 'twitter', 'x.com'
];

// Dominios o remitentes de sistema o no logísticos que nunca son cargas
const EXCLUDED_SENDERS = [
  'no-reply@accounts.google.com',
  'google.com',
  'openai.com',
  'notifications@github.com',
  'linkedin.com',
  'amazon.com',
  'facebookmail.com',
  'uber.com',
  'apple.com',
  'microsoft.com',
  'twitter.com',
  'x.com',
  'stripe.com'
];

/**
 * Clasificador inteligente de correos:
 * Discrimina correos operativos del transporte y Trucky de mensajes personales, spam o marketing.
 */
function classifyEmail(subject: string, text: string, fromAddress = '') {
  const sender = (fromAddress || '').toLowerCase();
  const subj = (subject || '').toLowerCase();
  const content = `${subj} ${text || ''}`.toLowerCase();

  // 1. Descartar automáticamente correos de sistema, Google, redes o tiendas
  if (EXCLUDED_SENDERS.some(dom => sender.includes(dom)) || sender.includes('google.com') || sender.includes('accounts.google')) {
    return { es_logistico: false, categoria: 'general' };
  }

  // 2. Si tiene palabras de exclusión (ocio, seguridad, e-commerce, promociones)
  const tieneExclusion = EXCLUSION_KEYWORDS.some(k => content.includes(k) || sender.includes(k));
  if (tieneExclusion) {
    // Solo permitir si explícitamente es un flete o rate confirmation inconfundible
    const esFleteInconfundible = content.includes('rate con') || content.includes('bill of lading') || content.includes('flete') || content.includes('freight load');
    if (!esFleteInconfundible) {
      return { es_logistico: false, categoria: 'general' };
    }
  }

  // 3. Evaluar presencia de términos clave de flete y transporte
  const hasMandatory = MANDATORY_LOGISTICS_TERMS.some(term => content.includes(term));
  const hasSubjectMatch = LOGISTICS_KEYWORDS.some(k => subj.includes(k));
  const hasTrucky = content.includes('trucky');

  // Si no coincide con ningún término obligatorio ni en el asunto ni es de Trucky, se descarta
  if (!hasMandatory && !hasSubjectMatch && !hasTrucky) {
    return { es_logistico: false, categoria: 'general' };
  }

  // 4. Categorización
  let categoria = 'cargas';
  if (content.includes('broker') || content.includes('rate') || content.includes('tarifa') || content.includes('packet') || content.includes('setup')) {
    categoria = 'brokers';
  }

  return { es_logistico: true, categoria };
}

export default async function syncGmail(req: Request, ctx: any) {
  // Cabeceras CORS por request: dependen del Origin que envía el navegador.
  const corsHeaders = corsHeadersFor(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let client: ImapFlow | null = null;

  try {
    const base44 = createClientFromRequest(req);
    const billingDenied=await liveBillingGuard(req,base44);
    if(billingDenied)return billingDenied;
    let currentUser: any = null;
    try {
      currentUser = await base44.auth.me();
    } catch (_) {
      currentUser = null;
    }

    const body = await req.json().catch(() => ({}));
    const { organization_id, profile_id, limit = 10, gmailUser: reqGmailUser, accessToken, user_id: reqUserId } = body;
    const finalUserId = currentUser?.id || reqUserId || null;
    const finalProfileId = profile_id ? String(profile_id) : null;

    // ─────────────────────────────────────────────────────────────────────────────
    // CASO 1: SINCRONIZACIÓN OFICIAL GOOGLE OAUTH 2.0 (REST API) — SIN CONTRASEÑAS
    // ─────────────────────────────────────────────────────────────────────────────
    if (accessToken) {
      console.log("[syncGmail] Sincronizando vía Google OAuth 2.0...");
      const fetchLimit = Math.max(Math.min(limit || 30, 50), 30);
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${fetchLimit}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!listRes.ok) {
        const errJson = await listRes.json().catch(() => ({}));
        const msg = errJson?.error?.message || `Error ${listRes.status} de Google OAuth`;
        return new Response(
          JSON.stringify({ error: `Fallo de autenticación con Google: ${msg}. Por favor vuelve a conectar tu cuenta.` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const listData = await listRes.json();
      const messages = listData.messages || [];

      // Obtener emails existentes en Base44 para deduplicar
      let existingEmails: any[] = [];
      try {
        const emailQueryClient = base44.asServiceRole?.entities?.Email || base44.entities.Email;
        existingEmails = await emailQueryClient.filter({}, '-fecha', 100);
      } catch (_) {
        existingEmails = [];
      }
      const existingMap = new Map();
      existingEmails.forEach((e: any) => {
        const acc = (e.google_account || '').toLowerCase().trim();
        const k = `${e.remitente_email}__${e.asunto}__${e.fecha?.slice(0, 16)}__${acc}`;
        existingMap.set(k, e);
      });

      const syncedEmails = [];
      let nuevosGuardados = 0;
      let omitidosNoLogisticos = 0;

      for (const msgMeta of messages) {
        const detailRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgMeta.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!detailRes.ok) continue;

        const detail = await detailRes.json();
        const headers = detail.payload?.headers || [];
        const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

        const subject = getHeader('Subject') || '(Sin asunto)';
        const fromHeader = getHeader('From') || 'desconocido@correo.com';
        const toHeader = getHeader('To') || 'usuario@gmail.com';
        const dateHeader = getHeader('Date') ? new Date(getHeader('Date')).toISOString() : new Date().toISOString();
        const snippet = detail.snippet || subject;

        // Extraer remitente nombre y email
        const fromMatch = fromHeader.match(/^(.*?)\s*<(.+?)>$/);
        const fromName = fromMatch ? fromMatch[1].replace(/["']/g, '').trim() : fromHeader.split('@')[0];
        const fromAddress = fromMatch ? fromMatch[2].trim() : fromHeader;

        // Deduplicar: si ya existe para este perfil y cuenta de Google, reutilizar
        const connectedGoogleAccount = (reqGmailUser || '').toLowerCase().trim();
        const dedupeKey = `${fromAddress}__${subject}__${dateHeader.slice(0, 16)}__${connectedGoogleAccount}`;
        if (existingMap.has(dedupeKey)) {
          syncedEmails.push(existingMap.get(dedupeKey));
          continue;
        }

        // Clasificar logística pasando fromAddress
        const { es_logistico, categoria } = classifyEmail(subject, snippet, fromAddress);
        if (!es_logistico) {
          omitidosNoLogisticos++;
          continue;
        }

        try {
          const emailEntity = base44.asServiceRole?.entities?.Email || base44.entities.Email;
          const nuevoRegistro = await emailEntity.create({
            organization_id: organization_id || null,
            profile_id: finalProfileId,
            created_by_id: finalUserId,
            google_account: connectedGoogleAccount || null,
            remitente_nombre: fromName,
            remitente_email: fromAddress,
            destinatario_email: toHeader,
            asunto: subject,
            cuerpo: snippet,
            snippet: snippet,
            fecha: dateHeader,
            leido: false,
            destacado: false,
            categoria,
            es_logistico: true,
            tipo_flujo: 'inbox',
          });

          syncedEmails.push(nuevoRegistro);
          nuevosGuardados++;
          existingMap.set(dedupeKey, nuevoRegistro);
        } catch (dbErr: any) {
          console.error("[syncGmail OAuth] Error guardando:", dbErr);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          nuevosGuardados,
          omitidosNoLogisticos,
          totalEncontrados: syncedEmails.length,
          emails: syncedEmails,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // CASO 2: FALLBACK IMAP (Sólo si se especifica usuario y contraseña de entorno)
    // ─────────────────────────────────────────────────────────────────────────────
    const gmailUser = (reqGmailUser && String(reqGmailUser).trim()) || Deno.env.get("GMAIL_USER");
    const rawPass = Deno.env.get("GMAIL_APP_PASSWORD");
    const gmailPass = rawPass ? rawPass.replace(/\s+/g, '') : null;

    if (!gmailUser || !gmailPass) {
      return new Response(
        JSON.stringify({ 
          error: "Para sincronizar sin contraseña, haz clic en 'Conectar con Google (OAuth 2.0)' arriba a la derecha." 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    try {
      // Timeout estricto de 10 segundos para conexión IMAP
      const connectPromise = client.connect();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Tiempo de espera agotado al conectar a imap.gmail.com (10s)")), 10000)
      );
      await Promise.race([connectPromise, timeoutPromise]);
    } catch (imapAuthError: any) {
      console.error("[syncGmail] Error de autenticación/conexión IMAP:", imapAuthError);
      return new Response(
        JSON.stringify({ 
          error: `Error de conexión con Gmail (${gmailUser}): ${imapAuthError.message || 'Verifica la contraseña de aplicación de 16 caracteres de Google y que IMAP esté habilitado'}` 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lock = await client.getMailboxLock('INBOX');

    const syncedEmails = [];
    let nuevosGuardados = 0;
    let omitidosNoLogisticos = 0;

    try {
      const status = await client.status('INBOX', { messages: true });
      const totalMessages = status.messages || 0;

      if (totalMessages > 0) {
        // Consultar los correos más recientes (máximo 10 para garantizar respuesta en <3 segundos)
        const fetchCount = Math.min(Math.max(1, limit), 10, totalMessages);
        const startSeq = Math.max(1, totalMessages - fetchCount + 1);
        const range = `${startSeq}:${totalMessages}`;

        // Obtener los correos existentes en Base44 para deduplicar (con fallback seguro)
        let existingEmails: any[] = [];
        try {
          const emailQueryClient = base44.asServiceRole?.entities?.Email || base44.entities.Email;
          existingEmails = await emailQueryClient.filter();
        } catch (filterErr: any) {
          console.warn("[syncGmail] No se pudieron precargar emails para deduplicar:", filterErr?.message || filterErr);
          existingEmails = [];
        }
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
          try {
            const emailEntity = base44.asServiceRole?.entities?.Email || base44.entities.Email;
            const nuevoRegistro = await emailEntity.create({
              organization_id: organization_id || null,
              profile_id: profile_id || null,
              created_by_id: currentUser?.id || null,
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
          } catch (dbInsertError: any) {
            console.error("[syncGmail] Error guardando email en Base44:", dbInsertError);
            return new Response(
              JSON.stringify({ 
                error: `Error al guardar en base de datos Base44: ${dbInsertError.message || 'Verifica los permisos RLS de la entidad Email'}` 
              }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
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
    console.error("Error no controlado en syncGmail:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Error inesperado al sincronizar con Gmail" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}