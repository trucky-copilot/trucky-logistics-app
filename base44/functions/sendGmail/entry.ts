import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import nodemailer from 'npm:nodemailer';
import { authorizePlanFeature } from '../../shared/entitlements.ts';

// CORS: solo se refleja el Origin cuando es un origen propio de la app (nunca
// el comodín "*"), igual que en translateChat, marketChat y syncGmail, para que
// un sitio ajeno no pueda disparar envíos desde el navegador de un visitante.
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

// El remitente se resuelve con el token de Google, nunca con un valor que venga
// en el cuerpo de la petición: así el "From" siempre es el dueño real del token.
async function resolveTokenOwnerEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const info = await res.json();
    const email = typeof info?.email === 'string' ? info.email.trim() : '';
    return email || null;
  } catch (_) {
    return null;
  }
}



function encodeBase64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function encodeBase64Url(str: string): string {
  return encodeBase64Utf8(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildRfc822Message(from: string, to: string, subject: string, bodyText: string): string {
  const utf8Subject = `=?utf-8?B?${encodeBase64Utf8(subject)}?=`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${utf8Subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    bodyText.replace(/\n/g, '<br/>'),
  ].join('\r\n');
}

export default async function sendGmail(req: Request, ctx: any) {
  const corsHeaders = corsHeadersFor(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const base44 = createClientFromRequest(req);

    // Solo usuarios con sesión: sin esto cualquier persona en internet podía
    // enviar correo con las credenciales de la app (phishing en su nombre).
    let user;
    try {
      user = await base44.auth.me();
    } catch (_) {
      user = null;
    }
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'No autorizado' }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Control de plan en el servidor: la pantalla del navegador no autoriza nada.
    const access = await authorizePlanFeature(base44, user, 'email_module');
    if (!access.allowed) {
      return new Response(
        JSON.stringify({ error: access.error, code: access.code }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();

    const {
      to,
      subject,
      content,
      organization_id,
      profile_id,
      remitente_nombre,
      categoria = 'cargas',
      load_id,
      accessToken,
    } = body;

    if (!to || !subject || !content) {
      return new Response(
        JSON.stringify({ error: "Faltan campos obligatorios: to, subject, content" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const toAddress = Array.isArray(to) ? to.join(', ') : to;
    const senderDisplayName = remitente_nombre || "Trucky Logistics";
    let messageId: string | null = null;
    let effectiveSenderEmail = "me";

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 1: Envío vía Google OAuth 2.0 (REST API de Gmail)
    // ─────────────────────────────────────────────────────────────────────────
    if (accessToken) {
      console.log("[sendGmail] Despachando vía Google OAuth 2.0 REST API...");
      // El buzón remitente es el dueño verificado del token, no un dato del body.
      effectiveSenderEmail = (await resolveTokenOwnerEmail(accessToken)) || effectiveSenderEmail;
      const fromAddress = effectiveSenderEmail !== 'me'
        ? `"${senderDisplayName}" <${effectiveSenderEmail}>`
        : senderDisplayName;

      const rawRfc = buildRfc822Message(fromAddress, toAddress, subject, content);
      const encodedRaw = encodeBase64Url(rawRfc);

      const googleRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: encodedRaw }),
      });

      if (!googleRes.ok) {
        const errJson = await googleRes.json().catch(() => ({}));
        const errMsg = errJson?.error?.message || `Error ${googleRes.status} de Google Gmail API`;
        console.error("[sendGmail] Error devuelto por Google:", errJson);
        return new Response(
          JSON.stringify({ error: `Fallo al enviar con Google: ${errMsg}` }),
          { status: googleRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const sendData = await googleRes.json();
      messageId = sendData.id || `g_${Date.now()}`;
    } else {
      // ─────────────────────────────────────────────────────────────────────────
      // CASO 2: Fallback a SMTP mediante nodemailer
      // Usa el buzón compartido de la app, así que queda limitado a admins: un
      // usuario normal envía siempre desde su propia cuenta de Google.
      // ─────────────────────────────────────────────────────────────────────────
      if (user.role !== 'admin') {
        return new Response(
          JSON.stringify({ error: "Conecta tu cuenta de Google para enviar correo desde tu propio buzón." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const gmailUser = Deno.env.get("GMAIL_USER");
      const rawPass = Deno.env.get("GMAIL_APP_PASSWORD");
      const gmailPass = rawPass ? rawPass.replace(/\s+/g, '') : null;

      if (!gmailUser || !gmailPass) {
        return new Response(
          JSON.stringify({
            error: "No se proporcionó un token de Google OAuth activo ni están configuradas credenciales SMTP (GMAIL_USER, GMAIL_APP_PASSWORD) en el entorno."
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      effectiveSenderEmail = gmailUser;
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: gmailUser,
          pass: gmailPass,
        },
      });

      const mailOptions = {
        from: `"${senderDisplayName}" <${gmailUser}>`,
        to: toAddress,
        subject: subject,
        text: content,
        html: content.replace(/\n/g, '<br/>'),
      };

      const info = await transporter.sendMail(mailOptions);
      messageId = info.messageId;
    }

    // Registro del correo enviado en Base44 para visualización inmediata en /emails
    let emailRecord = null;
    try {
      emailRecord = await base44.entities.Email.create({
        organization_id: organization_id || null,
        profile_id: profile_id || null,
        remitente_nombre: senderDisplayName,
        remitente_email: effectiveSenderEmail,
        destinatario_email: toAddress,
        asunto: subject,
        cuerpo: content,
        snippet: content.slice(0, 160).replace(/\r?\n/g, ' '),
        fecha: new Date().toISOString(),
        leido: true,
        destacado: false,
        categoria: categoria || 'cargas',
        es_logistico: true,
        tipo_flujo: 'sent',
        load_id: load_id || null,
      });
    } catch (dbErr) {
      console.error("No se pudo registrar correo en Base44:", dbErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        messageId: messageId,
        email: emailRecord,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error en sendGmail:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Error al enviar correo por Gmail" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}