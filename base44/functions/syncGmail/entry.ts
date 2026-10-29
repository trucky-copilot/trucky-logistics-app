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
  'carta porte', 'remolque', 'trailer', 'tractor', 'rfq', 'quote', 'quotes', 'rate request',
  'rate inquiry', 'overweight', 'tri-axle', 'tri axle', 'port', 'puerto', 'terminal', 'container',
  'containers', '20ft', '40ft', '40hc', '45hc', '20dc', '40dc', 'soc', 'shipment', 'shipments',
  'pickup', 'delivery', 'dispatch', 'dispatcher', 'carrier', 'broker'
];

// Palabras clave generales del ecosistema de logística
const LOGISTICS_KEYWORDS = [
  ...MANDATORY_LOGISTICS_TERMS,
  'carriers', 'brokers', 'dispatchers',
  'lane', 'lanes', 'mc#', 'mc number', 'dot#',
  'factoring', 'quickpay', 'camion', 'camiones', 'flota', 'flotas', 'trucky', 'cotizacion flete',
  'tarifa', 'rate', 'rates', 'cotizacion'
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
  'mercadolibre', 'ebay', 'aliexpress', 'linkedin', 'facebook', 'instagram', 'twitter', 'x.com',
  'grok for startups', 'xai'
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
  'stripe.com',
  'x.ai'
];

function normalizeForMatching(value: string) {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function containsTerm(text: string, term: string) {
  const normalizedText = normalizeForMatching(text);
  const normalizedTerm = normalizeForMatching(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${normalizedTerm}(?=$|[^a-z0-9])`).test(normalizedText);
}

/**
 * Clasificador inteligente de correos:
 * Discrimina correos operativos del transporte y Trucky de mensajes personales, spam o marketing.
 */
export function classifyEmail(subject: string, text: string, fromAddress = '', labels: string[] = []) {
  const sender = (fromAddress || '').toLowerCase();
  const subj = (subject || '').toLowerCase();
  const content = `${subj} ${text || ''}`.toLowerCase();

  const labelsLower = labels.map(l => (l || '').toLowerCase().trim());
  const isImportante = labelsLower.some(l => 
    l === 'important' || l === 'importante' || l.includes('important') || l.includes('importante') || l === 'starred'
  ) || /\b(importante|important|urgente)\b/i.test(subj);

  const hasLogisticsLabel = labelsLower.some(l =>
    ['broker', 'carrier', 'trucky', 'carga', 'cargas', 'flete', 'freight', 'dispatcher', 'load'].some(k => l.includes(k))
  );

  // 1. Descartar automáticamente correos de sistema, Google, redes o tiendas
  if (EXCLUDED_SENDERS.some(dom => sender.includes(dom)) || sender.includes('google.com') || sender.includes('accounts.google')) {
    return { es_logistico: false, categoria: 'general', isImportante: false };
  }

  // REGLA: Si tiene etiqueta de importante y también una etiqueta de broker/carrier/trucky etc.
  // Si están las dos -> MOSTRAR SIEMPRE ESOS CORREOS (garantiza es_logistico = true)
  if (isImportante && hasLogisticsLabel) {
    let categoria = 'cargas';
    if (labelsLower.some(l => l.includes('broker'))) {
      categoria = 'brokers';
    }
    return { es_logistico: true, categoria, isImportante: true, hasBothTags: true };
  }

  const hasMandatory = MANDATORY_LOGISTICS_TERMS.some(term => containsTerm(content, term));
  const hasSubjectMatch = LOGISTICS_KEYWORDS.some(term => containsTerm(subj, term));
  const hasTrucky = containsTerm(content, 'trucky');

  if (!hasMandatory && !hasSubjectMatch && !hasTrucky && !hasLogisticsLabel) {
    return { es_logistico: false, categoria: 'general', isImportante };
  }

  if (hasTrucky) {
    return { es_logistico: true, categoria: 'cargas', isImportante };
  }

  // 2. Si tiene palabras de exclusión (ocio, seguridad, e-commerce, promociones)
  const tieneExclusion = EXCLUSION_KEYWORDS.some(k => containsTerm(content, k) || sender.includes(k));
  if (tieneExclusion) {
    const esFleteInconfundible =
      ['rate con', 'bill of lading', 'flete', 'freight load', 'drayage', 'rate request', 'rfq'].some(term => containsTerm(content, term)) ||
      (hasTrucky && (hasMandatory || hasSubjectMatch));
    if (!esFleteInconfundible) {
      return { es_logistico: false, categoria: 'general', isImportante };
    }
  }

  // 4. Categorización
  let categoria = 'cargas';
  if (['broker', 'rate', 'tarifa', 'packet', 'setup', 'rfq', 'quote'].some(term => containsTerm(content, term)) || labelsLower.some(l => l.includes('broker'))) {
    categoria = 'brokers';
  }

  return { es_logistico: true, categoria, isImportante };
}

function decodeHtmlEntities(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<td[^>]*>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function getPlainText(payload: any): string {
  if (!payload) return '';

  if (payload?.mimeType === 'text/plain' && payload.body?.data) {
    try {
      const base64 = payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch (_) {}
  }

  if (Array.isArray(payload?.parts) && payload.parts.length > 0) {
    const plainParts = payload.parts
      .filter((p: any) => p.mimeType !== 'text/html')
      .map((part: any) => getPlainText(part))
      .filter(Boolean)
      .join('\n');
    if (plainParts.trim()) return plainParts;

    // Fallback a HTML si el correo solo tiene cuerpo HTML (muy común en tablas de brokers/drayage)
    const htmlParts = payload.parts
      .map((part: any) => getHtmlText(part))
      .filter(Boolean)
      .join('\n');
    if (htmlParts.trim()) return decodeHtmlEntities(htmlParts);
  }

  if (payload?.mimeType === 'text/html' && payload.body?.data) {
    try {
      const base64 = payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      const rawHtml = new TextDecoder().decode(bytes);
      return decodeHtmlEntities(rawHtml);
    } catch (_) {}
  }

  return '';
}

function getHtmlText(payload: any): string {
  if (!payload) return '';
  if (payload?.mimeType === 'text/html' && payload.body?.data) {
    try {
      const base64 = payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch (_) {}
  }
  return (payload?.parts || [])
    .map((p: any) => getHtmlText(p))
    .filter(Boolean)
    .join('\n');
}

export interface EmailAttachmentMeta {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
  gmail_message_id: string;
  inlineData?: string;
}

/**
 * Recorre recursivamente el payload MIME de Gmail para extraer todos los archivos adjuntos
 * (PDFs de Rate Confirmation, BOL, imágenes, documentos, etc.).
 */
export function extractAttachmentsMetadata(
  payload: any,
  gmailMessageId: string
): EmailAttachmentMeta[] {
  const results: EmailAttachmentMeta[] = [];
  const seenKeys = new Set<string>();

  function walk(part: any) {
    if (!part) return;

    const filename = typeof part.filename === 'string' ? part.filename.trim() : '';
    const attachmentId = part.body?.attachmentId ? String(part.body.attachmentId) : '';
    const inlineData = !attachmentId && part.body?.data ? String(part.body.data) : '';
    const size = Number(part.body?.size) || 0;
    const mimeType = part.mimeType || 'application/octet-stream';

    if (filename && (attachmentId || inlineData)) {
      const dedupeKey = `${filename}__${attachmentId || size}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        results.push({
          filename,
          mimeType,
          size,
          attachmentId,
          gmail_message_id: gmailMessageId,
          ...(inlineData && inlineData.length < 300000 ? { inlineData } : {}),
        });
      }
    }

    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        walk(child);
      }
    }
  }

  walk(payload);
  return results;
}

export function getFetchLimit(limit: unknown) {
  return Math.max(Math.min(Number(limit) || 80, 100), 40);
}

export function buildEmailDedupeKey(
  fromAddress: string,
  subject: string,
  date: string,
  googleAccount: string,
  organizationId: string | null,
  profileId: string | null,
) {
  return [
    organizationId || '',
    profileId || '',
    fromAddress.toLowerCase().trim(),
    subject.trim(),
    date.slice(0, 16),
    googleAccount.toLowerCase().trim(),
  ].join('__');
}

export default async function syncGmail(req: Request, ctx: any) {
  const corsHeaders = corsHeadersFor(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let client: ImapFlow | null = null;

  try {
    const base44 = createClientFromRequest(req);
    let currentUser: any = null;
    try {
      currentUser = await base44.auth.me();
    } catch (_) {
      currentUser = null;
    }

    // Solo usuarios con sesión: esta función escribe en la entidad Email y no
    // puede quedar abierta a llamadas anónimas.
    if (!currentUser) {
      return new Response(
        JSON.stringify({ error: 'No autorizado' }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { organization_id, profile_id, limit = 80, gmailUser: reqGmailUser, accessToken, user_id: reqUserId } = body;
    const finalUserId = currentUser?.id || reqUserId || null;
    const finalProfileId = profile_id ? String(profile_id) : null;

    // La organización destino debe pertenecer al usuario autenticado: sin esta
    // comprobación un llamador podía depositar correos en la bandeja de otra
    // organización.
    const requestedOrganizationId = organization_id ? String(organization_id) : null;
    if (requestedOrganizationId && currentUser.role !== 'admin') {
      const memberships = await base44.entities.OrganizationMember.filter({
        user_email: currentUser.email,
        active: true,
      });
      const belongsToOrganization = (memberships || []).some(
        (m: any) => String(m.organization_id) === requestedOrganizationId
      );
      if (!belongsToOrganization) {
        return new Response(
          JSON.stringify({ error: 'La organización indicada no pertenece a tu cuenta.' }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // CASO 1: SINCRONIZACIÓN OFICIAL GOOGLE OAUTH 2.0 (REST API) — SIN CONTRASEÑAS
    // ─────────────────────────────────────────────────────────────────────────────
    if (accessToken) {
      console.log("[syncGmail] Sincronizando vía Google OAuth 2.0...");
      const fetchLimit = getFetchLimit(limit);

      // Consultar tanto Recibidos/Enviados recientes como explícitamente correos IMPORTANTES para no perder ninguno por spam/promociones
      const [inboxListRes, importantListRes] = await Promise.all([
        fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${fetchLimit}&q=${encodeURIComponent('in:inbox OR in:sent OR label:important')}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        ),
        fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=35&labelIds=IMPORTANT`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        ).catch(() => null),
      ]);

      if (!inboxListRes.ok) {
        const errJson = await inboxListRes.json().catch(() => ({}));
        const msg = errJson?.error?.message || `Error ${inboxListRes.status} de Google OAuth`;
        return new Response(
          JSON.stringify({ error: `Fallo de autenticación con Google: ${msg}. Por favor vuelve a conectar tu cuenta.` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const listData = await inboxListRes.json();
      const impData = importantListRes && importantListRes.ok ? await importantListRes.json().catch(() => ({})) : {};

      // Combinar ambos listados sin duplicar IDs de Gmail
      const seenMsgIds = new Set<string>();
      const messages: Array<{ id: string; threadId?: string }> = [];
      for (const m of [...(listData.messages || []), ...(impData.messages || [])]) {
        if (m?.id && !seenMsgIds.has(m.id)) {
          seenMsgIds.add(m.id);
          messages.push(m);
        }
      }

      console.log(`[syncGmail] Gmail devolvió ${messages.length} mensajes únicos para procesar.`);

      // Obtener emails existentes en Base44 para deduplicar
      let existingEmails: any[] = [];
      try {
        const emailQueryClient = base44.asServiceRole?.entities?.Email || base44.entities.Email;
        existingEmails = await emailQueryClient.filter({}, '-fecha', 400);
      } catch (_) {
        existingEmails = [];
      }
      const existingMap = new Map();
      const existingByGmailId = new Map();
      existingEmails.forEach((e: any) => {
        if (e.gmail_message_id) {
          existingByGmailId.set(`${e.profile_id || ''}__${e.gmail_message_id}`, e);
        }
        const k = buildEmailDedupeKey(
          e.remitente_email || '',
          e.asunto || '',
          e.fecha || '',
          e.google_account || '',
          e.organization_id || null,
          e.profile_id ? String(e.profile_id) : null,
        );
        existingMap.set(k, e);
      });

      const syncedEmails = [];
      let nuevosGuardados = 0;
      let omitidosNoLogisticos = 0;
      let detallesCargados = 0;
      let coincidenciasTrucky = 0;
      let duplicados = 0;
      let reparados = 0;
      let erroresGuardado = 0;

      // Cargar mapeo de etiquetas de Gmail
      const labelMap = new Map<string, string>();
      try {
        const labelsRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/labels`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (labelsRes.ok) {
          const labelsData = await labelsRes.json();
          for (const lb of (labelsData.labels || [])) {
            if (lb.id && lb.name) {
              labelMap.set(lb.id, lb.name);
            }
          }
        }
      } catch (errLabels) {
        console.warn("[syncGmail] No se pudieron cargar etiquetas de Gmail:", errLabels);
      }

      // Descargar detalles de mensajes en lotes paralelos de 10 para alta velocidad
      const BATCH_SIZE = 10;
      const detailsList: any[] = [];
      for (let i = 0; i < messages.length; i += BATCH_SIZE) {
        const batch = messages.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (msgMeta) => {
            try {
              const detailRes = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgMeta.id}?format=full`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              if (!detailRes.ok) return null;
              return await detailRes.json();
            } catch (_) {
              return null;
            }
          })
        );
        for (const d of batchResults) {
          if (d) detailsList.push(d);
        }
      }

      for (const detail of detailsList) {
        detallesCargados++;
        const headers = detail.payload?.headers || [];
        const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

        const subject = getHeader('Subject') || '(Sin asunto)';
        const fromHeader = getHeader('From') || 'desconocido@correo.com';
        const toHeader = getHeader('To') || 'usuario@gmail.com';
        const rfcMessageId = getHeader('Message-ID') || getHeader('Message-Id') || '';

        // Usar internalDate de Gmail como fuente primaria infalible para evitar desfases de zonas horarias en el header Date
        let dateHeader = new Date().toISOString();
        if (detail.internalDate && !isNaN(Number(detail.internalDate))) {
          dateHeader = new Date(Number(detail.internalDate)).toISOString();
        } else if (getHeader('Date')) {
          const parsedDate = new Date(getHeader('Date'));
          if (!isNaN(parsedDate.getTime())) {
            dateHeader = parsedDate.toISOString();
          }
        }

        const bodyText = getPlainText(detail.payload);
        const adjuntos = extractAttachmentsMetadata(detail.payload, detail.id);
        const attachmentNamesText = adjuntos.map(a => a.filename).join(' ');
        const snippet = (detail.snippet || bodyText || subject).replace(/\s+/g, ' ').trim().slice(0, 500);
        if (containsTerm(`${subject}\n${bodyText}\n${detail.snippet || ''}\n${attachmentNamesText}`, 'trucky')) {
          coincidenciasTrucky++;
        }

        // Mapear etiquetas recibidas desde Gmail
        const rawLabelIds: string[] = Array.isArray(detail.labelIds) ? detail.labelIds : [];
        const resolvedLabels: string[] = rawLabelIds.map((id: string) => labelMap.get(id) || id);

        // Extraer remitente nombre y email
        const fromMatch = fromHeader.match(/^(.*?)\s*<(.+?)>$/);
        const fromName = fromMatch ? fromMatch[1].replace(/["']/g, '').trim() : fromHeader.split('@')[0];
        const fromAddress = fromMatch ? fromMatch[2].trim() : fromHeader;
        const connectedGoogleAccount = (reqGmailUser || '').toLowerCase().trim();
        const { es_logistico, categoria, isImportante } = classifyEmail(
          subject,
          `${bodyText}\n${detail.snippet || ''}\n${attachmentNamesText}`,
          fromAddress,
          resolvedLabels
        );

        const dedupeKey = buildEmailDedupeKey(
          fromAddress,
          subject,
          dateHeader,
          connectedGoogleAccount,
          organization_id || null,
          finalProfileId,
        );
        const existingEmail =
          existingByGmailId.get(`${finalProfileId || ''}__${detail.id}`) ||
          existingMap.get(dedupeKey);

        const isImportantFlag = Boolean(
          isImportante ||
          rawLabelIds.includes('IMPORTANT') ||
          rawLabelIds.includes('STARRED') ||
          resolvedLabels.some(l => l.toLowerCase().includes('important') || l.toLowerCase().includes('importante'))
        );

        if (existingEmail && es_logistico) {
          duplicados++;
          try {
            const emailEntity = base44.entities.Email;
            const updatedEmail = await emailEntity.update(existingEmail.id, {
              google_account: connectedGoogleAccount || existingEmail.google_account || null,
              remitente_nombre: fromName,
              destinatario_email: toHeader,
              cuerpo: (bodyText || detail.snippet || subject).slice(0, 50000),
              snippet,
              fecha: dateHeader,
              categoria,
              es_logistico: true,
              tipo_flujo: detail.labelIds?.includes('SENT') ? 'sent' : 'inbox',
              etiquetas: resolvedLabels,
              es_importante: isImportantFlag,
              thread_id: detail.threadId || existingEmail.thread_id || detail.id,
              gmail_message_id: detail.id,
              rfc_message_id: rfcMessageId || existingEmail.rfc_message_id || '',
              adjuntos,
            });
            syncedEmails.push(updatedEmail);
            reparados++;
            existingMap.set(dedupeKey, updatedEmail);
            existingByGmailId.set(`${finalProfileId || ''}__${detail.id}`, updatedEmail);
          } catch (dbErr: any) {
            erroresGuardado++;
            console.error("[syncGmail OAuth] Error actualizando correo existente:", dbErr);
          }
          continue;
        }

        if (!es_logistico) {
          omitidosNoLogisticos++;
          continue;
        }

        try {
          const emailEntity = base44.entities.Email;
          const nuevoRegistro = await emailEntity.create({
            organization_id: organization_id || null,
            profile_id: finalProfileId,
            created_by_id: finalUserId,
            google_account: connectedGoogleAccount || null,
            remitente_nombre: fromName,
            remitente_email: fromAddress,
            destinatario_email: toHeader,
            asunto: subject,
            cuerpo: (bodyText || detail.snippet || subject).slice(0, 50000),
            snippet: snippet,
            fecha: dateHeader,
            leido: !rawLabelIds.includes('UNREAD'),
            destacado: rawLabelIds.includes('STARRED'),
            categoria,
            es_logistico: true,
            tipo_flujo: detail.labelIds?.includes('SENT') ? 'sent' : 'inbox',
            etiquetas: resolvedLabels,
            es_importante: isImportantFlag,
            thread_id: detail.threadId || detail.id,
            gmail_message_id: detail.id,
            rfc_message_id: rfcMessageId || '',
            adjuntos,
          });

          syncedEmails.push(nuevoRegistro);
          nuevosGuardados++;
          existingMap.set(dedupeKey, nuevoRegistro);
          existingByGmailId.set(`${finalProfileId || ''}__${detail.id}`, nuevoRegistro);
        } catch (dbErr: any) {
          erroresGuardado++;
          console.error("[syncGmail OAuth] Error guardando:", dbErr);
        }
      }

      const diagnostics = {
        mensajesDevueltosPorGmail: messages.length,
        detallesCargados,
        coincidenciasTrucky,
        duplicados,
        reparados,
        omitidosNoLogisticos,
        erroresGuardado,
      };

      if (erroresGuardado > 0 && nuevosGuardados === 0 && reparados === 0) {
        return new Response(
          JSON.stringify({
            error: `${erroresGuardado} correo(s) de logística coincidieron, pero Base44 no pudo guardarlos.`,
            diagnostics,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          nuevosGuardados,
          omitidosNoLogisticos,
          totalEncontrados: syncedEmails.length,
          diagnostics,
          emails: syncedEmails,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // CASO 2: FALLBACK IMAP (Sólo si se especifica usuario y contraseña de entorno)
    // ─────────────────────────────────────────────────────────────────────────────
    if (currentUser.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: "Conecta tu cuenta de Google (OAuth 2.0) para sincronizar tu buzón." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gmailUser = (reqGmailUser && String(reqGmailUser).trim()) || Deno.env.get("GMAIL_USER");
    const rawPass = Deno.env.get("GMAIL_APP_PASSWORD");
    const gmailPass = rawPass ? rawPass.replace(/\s+/g, '') : null;

    if (!gmailUser || !gmailPass) {
      return new Response(
        JSON.stringify({ 
          error: "Para sincronizar sin contraseña, haz clic en 'Sincronizar' arriba a la derecha." 
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
        const fetchCount = Math.min(Math.max(1, limit), 10, totalMessages);
        const startSeq = Math.max(1, totalMessages - fetchCount + 1);
        const range = `${startSeq}:${totalMessages}`;

        let existingEmails: any[] = [];
        try {
          const emailQueryClient = base44.entities.Email;
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

          const dedupeKey = `${fromAddress}__${subject}__${date.slice(0, 16)}`;
          if (existingSet.has(dedupeKey)) {
            continue;
          }

          const { es_logistico, categoria } = classifyEmail(subject, plainText);

          if (!es_logistico) {
            omitidosNoLogisticos++;
            continue;
          }

          try {
            const emailEntity = base44.entities.Email;
            const nuevoRegistro = await emailEntity.create({
              organization_id: organization_id || null,
              profile_id: profile_id || null,
              remitente_nombre: fromName,
              remitente_email: fromAddress,
              destinatario_email: toAddress,
              asunto: subject,
              cuerpo: plainText || snippet,
              snippet: snippet || subject,
              fecha: date,
              leido: false,
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
