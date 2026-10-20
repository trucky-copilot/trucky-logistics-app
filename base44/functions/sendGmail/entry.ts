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
    } = body;

    if (!to || !subject || !content) {
      return new Response(
        JSON.stringify({ error: "Faltan campos obligatorios: to, subject, content" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gmailUser = Deno.env.get("GMAIL_USER");
    const rawPass = Deno.env.get("GMAIL_APP_PASSWORD");
    const gmailPass = rawPass ? rawPass.replace(/\s+/g, '') : null;

    if (!gmailUser || !gmailPass) {
      return new Response(
        JSON.stringify({ error: "Credenciales de Gmail no configuradas en el entorno (GMAIL_USER, GMAIL_APP_PASSWORD)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Configuración del transporte seguro SMTP de Gmail
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: gmailUser,
        pass: gmailPass,
      },
    });

    const senderDisplayName = remitente_nombre || "Trucky Logistics";
    const mailOptions = {
      from: `"${senderDisplayName}" <${gmailUser}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: subject,
      text: content,
      html: content.replace(/\n/g, '<br/>'),
    };

    const info = await transporter.sendMail(mailOptions);

    // Registro del correo enviado en Base44 para visualización inmediata en /emails
    let emailRecord = null;
    try {
      emailRecord = await base44.entities.Email.create({
        organization_id: organization_id || null,
        profile_id: profile_id || null,
        remitente_nombre: senderDisplayName,
        remitente_email: gmailUser,
        destinatario_email: Array.isArray(to) ? to.join(', ') : to,
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
        messageId: info.messageId,
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
