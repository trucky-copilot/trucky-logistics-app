/**
 * Utilidad compartida para el flujo de Automatización de Despacho en Trucky:
 * 1) Email (Adjunto PDF + Hilo) -> Verificador de Documentos (/documentos)
 * 2) Verificador -> Crear Carga en Mis Cargas (/cargas) con datos extraídos + resumen del hilo
 * 3) Flota (/flota) -> Asignar conductor disponible a la carga -> Visible en el rol Carrier (/cargas)
 * 4) Redirección a Emails (/emails) con borrador prellenado para Broker y Carrier.
 */

export const AUTOMATION_EMAIL_TO_CHECKER_KEY = 'trucky_auto_email_to_checker_v1';
export const AUTOMATION_CHECKER_TO_LOAD_KEY = 'trucky_auto_checker_to_load_v1';
export const AUTOMATION_PENDING_DISPATCH_LOAD_KEY = 'trucky_auto_pending_dispatch_load_v1';
export const AUTOMATION_FLEET_TO_EMAIL_DRAFT_KEY = 'trucky_auto_fleet_to_email_draft_v1';

const CITY_COORDS = {
  miami: [25.7617, -80.1918],
  'port miami': [25.7743, -80.1704],
  portmiami: [25.7743, -80.1704],
  'port everglades': [26.0912, -80.1184],
  'fort lauderdale': [26.1224, -80.1373],
  'west palm beach': [26.7153, -80.0534],
  tampa: [27.9506, -82.4572],
  orlando: [28.5383, -81.3792],
  jacksonville: [30.3322, -81.6557],
  savannah: [32.0809, -81.0912],
  atlanta: [33.749, -84.388],
  charlotte: [35.2271, -80.8431],
  dallas: [32.7767, -96.797],
  houston: [29.7604, -95.3698],
  chicago: [41.8781, -87.6298],
  naples: [26.142, -81.7948],
  hialeah: [25.8576, -80.2781],
  doral: [25.8195, -80.3553],
  medley: [25.8506, -80.3264],
  pompano: [26.2379, -80.1248],
  lakeland: [28.0395, -81.9498],
  ocala: [29.1872, -82.1401],
};

function estimateMilesBetween(originStr = '', destStr = '') {
  const oLow = String(originStr).toLowerCase();
  const dLow = String(destStr).toLowerCase();
  let oCoord = null;
  let dCoord = null;
  for (const [city, coords] of Object.entries(CITY_COORDS)) {
    if (!oCoord && oLow.includes(city)) oCoord = coords;
    if (!dCoord && dLow.includes(city)) dCoord = coords;
  }
  if (!oCoord || !dCoord) return 250;
  const R = 3958.8; // Radio de la Tierra en millas
  const dLat = ((dCoord[0] - oCoord[0]) * Math.PI) / 180;
  const dLon = ((dCoord[1] - oCoord[1]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((oCoord[0] * Math.PI) / 180) *
      Math.cos((dCoord[0] * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const roadFactor = 1.22;
  return Math.max(25, Math.round(R * c * roadFactor));
}

/**
 * Normaliza cualquier fecha textual (ej. "04/14/2026", "2026-10-29", "Oct 29, 2026") a YYYY-MM-DD para inputs <input type="date">.
 */
export function normalizeToIsoDate(rawDate) {
  if (!rawDate) return '';
  const str = String(rawDate).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // MM/DD/YYYY o DD/MM/YYYY
  const slashMatch = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slashMatch) {
    let [, p1, p2, p3] = slashMatch;
    if (p3.length === 2) p3 = `20${p3}`;
    const m = Number(p1) > 12 ? p2 : p1;
    const d = Number(p1) > 12 ? p1 : p2;
    return `${p3}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return '';
}

/**
 * Extrae datos logísticos de un documento o hilo de correo mediante expresiones regulares
 * como respaldo o complemento cuando los datos de la IA son parciales.
 */
export function extractLogisticsFieldsFromText(fullText = '', fallbackSubject = '', fallbackSender = '') {
  const text = `${fallbackSubject}\n${fullText}`;

  // Ruta tipo "Miami a Tampa", "Miami, FL to Tampa, FL", "Route: X -> Y", "Origin: X Destination: Y"
  let origen = '';
  let destino = '';

  const originMatch = text.match(/(?:origin|origen|pickup(?:\s*location)?|shipper|from|desde)\s*[:\-]\s*([^\n\r|]+)/i);
  const destMatch = text.match(/(?:destination|destino|delivery(?:\s*location)?|consignee|to|hacia)\s*[:\-]\s*([^\n\r|]+)/i);
  if (originMatch) origen = originMatch[1].trim().slice(0, 80);
  if (destMatch) destino = destMatch[1].trim().slice(0, 80);

  if (!origen || !destino) {
    const arrowMatch = text.match(/([A-Za-zÁÉÍÓÚÑáéíóúñ .]+(?:,\s*[A-Z]{2})?)\s*(?:->|→|\ba\b|\bto\b)\s*([A-Za-zÁÉÍÓÚÑáéíóúñ .]+(?:,\s*[A-Z]{2})?)/i);
    if (arrowMatch) {
      if (!origen) origen = arrowMatch[1].replace(/^(re|fw|fwd|rate|load|trucky|carrier)\s*[:\-]?\s*/gi, '').trim().slice(0, 60);
      if (!destino) destino = arrowMatch[2].replace(/\b(trucky|carrier|broker|load|rate)\b.*$/gi, '').trim().slice(0, 60);
    }
  }

  // Tarifa ($1,450.00, Rate: $950, Total: $1200)
  let tarifa = 0;
  const rateMatch =
    text.match(/(?:rate|tarifa|total|flat|line\s*haul|pay)\s*[:\-]?\s*\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/i) ||
    text.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?|[3-9][0-9]{2,4}(?:\.[0-9]{2})?)/);
  if (rateMatch) {
    tarifa = Number(String(rateMatch[1]).replace(/,/g, '')) || 0;
  }

  // Millas
  let millas = 0;
  const milesMatch = text.match(/([0-9]{2,4}(?:[.,][0-9]+)?)\s*(?:miles|millas|loaded\s*miles|\bmi\b)/i);
  if (milesMatch) {
    millas = Number(String(milesMatch[1]).replace(',', '.')) || 0;
  }
  if (!millas && origen && destino) {
    millas = estimateMilesBetween(origen, destino);
  }

  // Fechas (MM/DD/YYYY o YYYY-MM-DD)
  const dateMatches = text.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g) || [];
  const pickupDate = normalizeToIsoDate(dateMatches[0]) || new Date().toISOString().slice(0, 10);
  const deliveryDate = normalizeToIsoDate(dateMatches[1] || dateMatches[0]) || pickupDate;

  // Citas / Horarios (ej. 08:00 AM, 14:00, @ 09:00)
  const timeMatches = text.match(/\b(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)\b/g) || [];
  const citasResumen = timeMatches.length > 0 ? timeMatches.slice(0, 3).join(' / ') : 'Por confirmar en ventana operativa';

  // Referencia / Load #
  const refMatch =
    text.match(/(?:load\s*#|load\s*number|ref(?:erence)?\s*#|do\s*#|order\s*#|bol\s*#)\s*[:\-]?\s*([A-Z0-9\-]{3,25})/i) ||
    text.match(/\b(RC-[0-9A-Z\-]+|DO-[0-9A-Z\-]+|LOAD-[0-9A-Z\-]+)\b/i);
  const numero_referencia = refMatch ? refMatch[1].trim() : '';

  // Broker
  const brokerMatch = text.match(/(?:broker|company|dispatcher)\s*[:\-]\s*([^\n\r|]+)/i);
  const broker_nombre = (brokerMatch ? brokerMatch[1].trim() : fallbackSender || '').slice(0, 70);

  return {
    origen: origen || 'Miami, FL',
    destino: destino || 'Tampa, FL',
    millas: millas || 250,
    tarifa_negociada: tarifa || 850,
    tarifa_ofrecida: tarifa || 850,
    fecha_carga: pickupDate,
    fecha_entrega: deliveryDate,
    citas: citasResumen,
    numero_referencia,
    broker_nombre: broker_nombre || 'Broker',
  };
}

/**
 * Construye el resumen ejecutivo estructurado del hilo de correo (direcciones, fechas, citas y mensajes).
 */
export function buildThreadSummaryForLoad({ threadMessages = [], extracted = {}, emailSubject = '', brokerEmail = '' }) {
  const combinedText = threadMessages
    .map(m => `${m.asunto || ''}\n${m.cuerpo || m.snippet || ''}`)
    .join('\n\n');

  const fallback = extractLogisticsFieldsFromText(
    combinedText,
    emailSubject,
    threadMessages[0]?.remitente_nombre || brokerEmail
  );

  const origen = extracted?.origen || fallback.origen;
  const destino = extracted?.destino || fallback.destino;
  const pickupFecha = normalizeToIsoDate(extracted?.pickup_fecha) || fallback.fecha_carga;
  const deliveryFecha = normalizeToIsoDate(extracted?.delivery_fecha) || fallback.fecha_entrega;
  const pickupHora = extracted?.pickup_hora || '';
  const deliveryHora = extracted?.delivery_hora || '';
  const appointmentWindow = extracted?.appointment_window || fallback.citas;
  const refNum =
    extracted?.load_number ||
    extracted?.reference_number ||
    extracted?.delivery_order_number ||
    fallback.numero_referencia ||
    'S/N';

  const msgBullets = threadMessages.slice(-4).map((m) => {
    const sender = m.remitente_nombre || m.remitente_email || 'Contacto';
    const cleanSnippet = String(m.cuerpo || m.snippet || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
    return `• [${sender}]: ${cleanSnippet}`;
  });

  const summaryLines = [
    `📋 RESUMEN DEL HILO Y DOCUMENTO VERIFICADO`,
    `• Direcciones: Origen: ${origen} → Destino: ${destino}`,
    `• Fechas: Pickup ${pickupFecha}${pickupHora ? ' (' + pickupHora + ')' : ''} | Entrega ${deliveryFecha}${deliveryHora ? ' (' + deliveryHora + ')' : ''}`,
    `• Citas / Ventana horaria: ${appointmentWindow}`,
    `• Referencia / Load #: ${refNum}`,
    brokerEmail ? `• Contacto Broker: ${brokerEmail}` : null,
    msgBullets.length > 0 ? `• Historial del Hilo:\n${msgBullets.join('\n')}` : null,
  ].filter(Boolean);

  return {
    origen,
    destino,
    millas: Number(extracted?.millas) || fallback.millas || 250,
    tarifa_negociada: Number(extracted?.tarifa_total) || fallback.tarifa_negociada || 0,
    tarifa_ofrecida: Number(extracted?.tarifa_total) || fallback.tarifa_ofrecida || 0,
    fecha_carga: pickupFecha,
    fecha_entrega: deliveryFecha,
    citas: appointmentWindow,
    numero_referencia: refNum !== 'S/N' ? refNum : '',
    broker_nombre: extracted?.broker_nombre || fallback.broker_nombre,
    notas: summaryLines.join('\n'),
  };
}

