import fs from 'fs';
import path from 'path';

// Palabras clave logísticas con coincidencia estricta de palabra completa
const LOGISTICS_KEYWORDS = [
  'load', 'loads', 'freight', 'rate', 'rates', 'lane', 'lanes', 'reefer', 'dry van', 'drayage', 'flatbed',
  'container', 'containers', 'chassis', 'detention', 'layover', 'tonu', 'bol', 'bill of lading',
  'rate confirmation', 'rate con', 'delivery order', 'proof of delivery', 'pod',
  'lumper', 'carrier', 'carriers', 'broker', 'brokers', 'dispatcher', 'dispatch', 'pickup',
  'origin', 'destination', 'mc#', 'mc number', 'dot#', 'factoring', 'quickpay',
  'settlement', 'deadhead', 'all-in', 'rpm', 'flete', 'fletes', 'carga', 'cargas', 'camion', 'camiones',
  'remolque', 'orden de entrega', 'carta porte', 'cotización', 'cotizacion', 'tarifa', 'tarifas', 'trucky',
  'rate quote', 'load offer', 'quote'
];

// Palabras clave de ocio / familiares / newsletters / retail para exclusión automática
const EXCLUSION_KEYWORDS = [
  'mamá', 'mama', 'papá', 'papa', 'hijo', 'hija', 'familia', 'abuelo', 'abuela',
  'netflix', 'spotify', 'steam', 'playstation', 'xbox', 'disney+', 'prime video',
  'hbo', 'twitch', 'uber eats', 'rappi', 'pedidosya', 'casino', 'lotería',
  'reserva de hotel', 'vuelo vacacional', 'cena familiar', 'linkedin', 'newsletter',
  'recarga digital', 'recargasweb', 'tarjetatullave', 'tullave', 'openrouter', 'alerta de seguridad', 'seguridad en tu cuenta',
  'remote roles', 'jobgether', 'vacantes', 'computrabajo', 'elempleo', 'michael page', 'michaelpage',
  'temu', 'amazon', 'mercadolibre', 'mercado libre', 'aliexpress', 'shein', 'ebay', 'walmart',
  'aptprimo', 'aptuno', 'fincaraiz', 'metrocuadrado', 'ciencuadras',
  'despegar', 'booking', 'airbnb', 'avianca', 'latam'
];

function classifyEmail(subject, text, fromAddress = '') {
  const content = `${subject || ''} ${text || ''}`.toLowerCase();
  const fromLower = (fromAddress || '').toLowerCase();

  // 1. Exclusión directa por remitente o contenido
  const esRemitenteExcluido = EXCLUSION_KEYWORDS.some(k => fromLower.includes(k));
  const tieneContenidoExcluido = EXCLUSION_KEYWORDS.some(k => content.includes(k));

  // No excluir si es enviado expresamente por Trucky o cotización de tarifa
  const esCotizacionTrucky = content.includes('trucky') || content.includes('cotización de tarifa') || content.includes('cotizacion de tarifa');

  if ((esRemitenteExcluido || tieneContenidoExcluido) && !esCotizacionTrucky) {
    return { es_logistico: false, categoria: 'general' };
  }

  // 2. Coincidencia estricta de palabras logísticas
  const matchesLogistics = LOGISTICS_KEYWORDS.filter(k => {
    if (k.includes(' ') || k.includes('#') || k.includes('ó')) {
      return content.includes(k);
    }
    const regex = new RegExp(`\\b${k}\\b`, 'i');
    return regex.test(content);
  });

  if (matchesLogistics.length > 0 || esCotizacionTrucky) {
    let categoria = 'cargas';
    if (esCotizacionTrucky || content.includes('broker') || content.includes('quote') || content.includes('tarifa') || content.includes('rate')) {
      categoria = 'brokers';
    }
    return { es_logistico: true, categoria };
  }

  return { es_logistico: false, categoria: 'general' };
}

// Cargar credenciales desde base44/.env
function getGmailCredentials(rootPath) {
  const envPath = path.resolve(rootPath, 'base44/.env');
  let user = process.env.GMAIL_USER;
  let pass = process.env.GMAIL_APP_PASSWORD;

  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*)\s*$/);
      if (match) {
        if (match[1] === 'GMAIL_USER') user = match[2].trim();
        if (match[1] === 'GMAIL_APP_PASSWORD') pass = match[2].trim();
      }
    }
  }

  if (pass) {
    pass = pass.replace(/\s+/g, '');
  }

  return { user, pass };
}

// Persistencia en archivo JSON local aislado en scratch
function getStorageFile(rootPath) {
  const scratchDir = path.resolve(rootPath, 'scratch');
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }
  const file = path.join(scratchDir, 'local_emails.json');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify([]), 'utf-8');
  }
  return file;
}

function readLocalEmails(rootPath) {
  try {
    const file = getStorageFile(rootPath);
    return JSON.parse(fs.readFileSync(file, 'utf-8') || '[]');
  } catch (_) {
    return [];
  }
}

function writeLocalEmails(rootPath, emails) {
  try {
    const file = getStorageFile(rootPath);
    fs.writeFileSync(file, JSON.stringify(emails, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error guardando correos locales:', err);
  }
}

export function createLocalEmailMiddleware(rootPath) {
  return async (req, res, next) => {
    // ─── GET /api/local-emails (Listar correos) ──────────────────────────────
    if (req.url.startsWith('/api/local-emails') && req.method === 'GET') {
      const emails = readLocalEmails(rootPath);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(emails));
      return;
    }

    // ─── PATCH /api/local-emails/:id (Actualizar leido/destacado) ────────────
    if (req.url.startsWith('/api/local-emails/') && req.method === 'PATCH') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const id = req.url.split('/api/local-emails/')[1];
        const patch = JSON.parse(body || '{}');
        const emails = readLocalEmails(rootPath);
        const index = emails.findIndex(e => e.id === id);
        if (index !== -1) {
          emails[index] = { ...emails[index], ...patch };
          writeLocalEmails(rootPath, emails);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(emails[index]));
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Email not found' }));
        }
      });
      return;
    }

    // ─── POST /api/local-functions/sendGmail ────────────────────────────────
    if (req.url === '/api/local-functions/sendGmail' && req.method === 'POST') {
      let bodyStr = '';
      req.on('data', chunk => bodyStr += chunk);
      req.on('end', async () => {
        try {
          const body = JSON.parse(bodyStr || '{}');
          const { to, subject, content, organization_id, profile_id, remitente_nombre, categoria } = body;

          const { user, pass } = getGmailCredentials(rootPath);
          if (!user || !pass) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Credenciales de Gmail no configuradas en base44/.env' }));
            return;
          }

          // Carga dinámica de nodemailer en Node
          const nodemailer = (await import('nodemailer')).default;
          const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: { user, pass }
          });

          const senderName = remitente_nombre || 'Trucky Logistics';
          const info = await transporter.sendMail({
            from: `"${senderName}" <${user}>`,
            to: Array.isArray(to) ? to.join(', ') : to,
            subject: subject,
            text: content,
            html: content.replace(/\n/g, '<br/>')
          });

          // Registrar en almacén local
          const emailRecord = {
            id: `email_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            organization_id: organization_id || null,
            profile_id: profile_id || null,
            remitente_nombre: senderName,
            remitente_email: user,
            destinatario_email: Array.isArray(to) ? to.join(', ') : to,
            asunto: subject,
            cuerpo: content,
            snippet: content.slice(0, 160).replace(/\r?\n/g, ' '),
            fecha: new Date().toISOString(),
            leido: true,
            destacado: false,
            categoria: categoria || 'cargas',
            es_logistico: true,
            tipo_flujo: 'sent'
          };

          const localEmails = readLocalEmails(rootPath);
          localEmails.unshift(emailRecord);
          writeLocalEmails(rootPath, localEmails);

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            success: true,
            messageId: info.messageId,
            email: emailRecord
          }));
        } catch (err) {
          console.error('[local sendGmail error]:', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message || 'Error al enviar por Gmail' }));
        }
      });
      return;
    }

    // ─── POST /api/local-functions/syncGmail ────────────────────────────────
    if (req.url === '/api/local-functions/syncGmail' && req.method === 'POST') {
      let bodyStr = '';
      req.on('data', chunk => bodyStr += chunk);
      req.on('end', async () => {
        let client = null;
        try {
          const body = JSON.parse(bodyStr || '{}');
          const { organization_id, profile_id, limit = 20, gmailUser } = body;

          const envCreds = getGmailCredentials(rootPath);
          const user = (gmailUser && gmailUser.trim()) || envCreds.user;
          const pass = envCreds.pass;
          if (!user || !pass) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Credenciales de Gmail no configuradas en base44/.env' }));
            return;
          }

          const { ImapFlow } = await import('imapflow');
          const { simpleParser } = await import('mailparser');

          client = new ImapFlow({
            host: 'imap.gmail.com',
            port: 993,
            secure: true,
            auth: { user, pass },
            logger: false
          });

          await client.connect();
          const lock = await client.getMailboxLock('INBOX');

          let nuevosGuardados = 0;
          let omitidosNoLogisticos = 0;

          try {
            const status = await client.status('INBOX', { messages: true });
            const totalMessages = status.messages || 0;

            if (totalMessages > 0) {
              const fetchCount = Math.min(limit, totalMessages);
              const startSeq = Math.max(1, totalMessages - fetchCount + 1);
              const range = `${startSeq}:${totalMessages}`;

              const localEmails = readLocalEmails(rootPath);
              const existingSet = new Set(
                localEmails.map(e => `${e.remitente_email}__${e.asunto}__${e.fecha?.slice(0, 16)}`)
              );

              for await (const msg of client.fetch(range, { source: true, envelope: true })) {
                if (!msg.source) continue;

                const parsed = await simpleParser(msg.source);
                const subject = parsed.subject || '(Sin asunto)';
                const fromAddress = parsed.from?.value?.[0]?.address || 'contacto@empresa.com';
                const fromName = parsed.from?.value?.[0]?.name || fromAddress.split('@')[0];
                const date = parsed.date ? parsed.date.toISOString() : new Date().toISOString();
                const plainText = parsed.text || '';
                const snippet = plainText.slice(0, 180).replace(/\r?\n+/g, ' ').trim();

                const dedupeKey = `${fromAddress}__${subject}__${date.slice(0, 16)}`;
                if (existingSet.has(dedupeKey)) continue;

                // Filtro inteligente
                const { es_logistico, categoria } = classifyEmail(subject, plainText, fromAddress);
                if (!es_logistico) {
                  omitidosNoLogisticos++;
                  continue;
                }

                const nuevoEmail = {
                  id: `email_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                  organization_id: organization_id || null,
                  profile_id: profile_id || null,
                  remitente_nombre: fromName,
                  remitente_email: fromAddress,
                  destinatario_email: user,
                  asunto: subject,
                  cuerpo: plainText || snippet,
                  snippet: snippet || subject,
                  fecha: date,
                  leido: false,
                  destacado: false,
                  categoria,
                  es_logistico: true,
                  tipo_flujo: 'inbox'
                };

                localEmails.unshift(nuevoEmail);
                existingSet.add(dedupeKey);
                nuevosGuardados++;
              }

              writeLocalEmails(rootPath, localEmails);
            }
          } finally {
            lock.release();
          }

          await client.logout();

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            success: true,
            nuevosGuardados,
            omitidosNoLogisticos
          }));
        } catch (err) {
          if (client) {
            try { await client.logout(); } catch (_) {}
          }
          console.error('[local syncGmail error]:', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message || 'Error al sincronizar con Gmail' }));
        }
      });
      return;
    }

    next();
  };
}
