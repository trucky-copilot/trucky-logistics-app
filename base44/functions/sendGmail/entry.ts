import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import nodemailer from 'npm:nodemailer';

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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const base44 = createClientFromRequest(req);
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
      gmailUser: reqGmailUser,
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
    let effectiveSenderEmail = reqGmailUser || "me";

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 1: Envío vía Google OAuth 2.0 (REST API de Gmail)
    // ─────────────────────────────────────────────────────────────────────────
    if (accessToken) {
      console.log("[sendGmail] Despachando vía Google OAuth 2.0 REST API...");
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
      // ─────────────────────────────────────────────────────────────────────────
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
