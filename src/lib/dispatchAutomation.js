/**
 * Utilidad compartida para el flujo de Automatización de Despacho en Trucky:
 * 1) Email (Adjunto PDF + Hilo) -> Verificador de Documentos (/documentos)
 * 2) Crear Carga en Mis Cargas (/cargas) con datos extraídos fielmente del PDF/Rate Confirmation
 * 3) Flota (/flota) -> Botón en la esquina superior junto a "+ Agregar camión" para elegir conductor disponible
 * 4) Redirección a Emails (/emails) con borrador prellenado para Broker y Carrier.
 */

import { splitQuoted } from './emailThread.js';

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
  bryn: [40.0218, -75.3163],
  philadelphia: [39.9526, -75.1652],
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
  if (!oCoord || !dCoord) return 0; // sin coordenadas no se inventan millas (antes: 250)
  const R = 3958.8;
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
 * Normaliza cualquier fecha textual (ej. "04/15/2026", "04-15-2026", "2026-10-29") a YYYY-MM-DD.
 */
export function normalizeToIsoDate(rawDate) {
  if (!rawDate) return '';
  const str = String(rawDate).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

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
 * Extrae con alta fidelidad los datos de un Rate Confirmation (incluyendo formato Shipper 1 / Consignee 1,
 * Agreed Amount, Ship Date, Load #, W/O, Shipping Note, etc.) priorizando siempre el documento PDF adjunto
 * sobre el texto corto del correo.
 */
export function extractLogisticsFieldsFromText(fullText = '', fallbackSubject = '', fallbackSender = '') {
  // Separar el texto del PDF adjunto del hilo de correo si vienen unidos
  const parts = String(fullText || '').split('=== HILO DE CORREO ASOCIADO ===');
  const pdfDocText = (parts[0] || '').trim();
  const threadOnlyText = (parts[1] || '').trim();
  const primaryText = pdfDocText || threadOnlyText || fullText || '';

  // 1. BROKER (priorizar cabecera de empresa en el PDF tipo "CARGO CONVOY INC" o "Broker: ...")
  let broker_nombre = '';
  const companyHeaderMatch =
    primaryText.match(/\b([A-Z][A-Z0-9\s,&.\-]{2,40}\s(?:INC|LLC|CORP|LOGISTICS|FREIGHT|TRANSPORT|CONVOY\.?))\b/) ||
    primaryText.match(/(?:broker|company)\s*[:\-]\s*([^\n\r|]+)/i);
  if (companyHeaderMatch) {
    broker_nombre = companyHeaderMatch[1].replace(/\s+/g, ' ').trim();
  }
  if (!broker_nombre) {
    const emailDomainMatch = primaryText.match(/@([a-z0-9\-]+)\.[a-z]{2,}/i);
    if (emailDomainMatch && !/gmail|yahoo|outlook|hotmail|trucky/i.test(emailDomainMatch[1])) {
      broker_nombre = emailDomainMatch[1].toUpperCase();
    } else if (fallbackSender && !/trucky\s*app/i.test(fallbackSender)) {
      broker_nombre = fallbackSender.trim();
    } else {
      broker_nombre = fallbackSender || 'Broker';
    }
  }

  // 2. TARIFA / AGREED AMOUNT (priorizar "Agreed Amount: $450", "Total: $...", "Rate: $...")
  let tarifa = 0;
  const agreedMatch =
    primaryText.match(/(?:agreed\s*amount|rate\s*amount|total\s*rate|line\s*haul|flat\s*rate|rate|tarifa|total)\s*[:\-]?\s*(?:USD\s*)?\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/i) ||
    primaryText.match(/Agreed\s+Amount\s*[:\-]?[\s\S]{0,120}?\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/i);

  if (agreedMatch) {
    tarifa = Number(String(agreedMatch[1]).replace(/,/g, '')) || 0;
  } else {
    // Buscar montos con $ en el PDF ignorando cargos por demora ("USD 200 PER DAY")
    const allDollarMatches = [...primaryText.matchAll(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[2-9][0-9]{2,4}(?:\.[0-9]{2})?)/g)];
    if (allDollarMatches.length > 0) {
      tarifa = Number(String(allDollarMatches[0][1]).replace(/,/g, '')) || 0;
    }
  }

  // 3. ORIGEN Y DESTINO (priorizar Shipper 1 / Consignee 1 / Receiver 1 / Shipping Address / Delivery Address en el PDF)
  let origen = '';
  let destino = '';

  // Buscar bloque Shipper 1 y bloque Consignee / Receiver / Delivery
  const shipperSectionMatch = primaryText.match(/Shipper\s*1?([\s\S]*?)(?=Consignee|Receiver|Delivery\s*1|Stop\s*2|$)/i);
  const consigneeSectionMatch = primaryText.match(/(?:Consignee|Receiver|Delivery)\s*1?([\s\S]*?)(?=Carrier\s*Pay|Instructions|Terms|Signature|$)/i);

  if (shipperSectionMatch) {
    const sBlock = shipperSectionMatch[1];
    const addrMatch = sBlock.match(/Shipping\s*Address\s*[:\-]\s*([^\n\r]+?)(?=\s+Weight\s*:|\s+Description|\s+Date\s*:|$)/i);
    const nameMatch = sBlock.match(/Name\s*[:\-]\s*([^\n\r]+?)(?=\s+Type\s*:|\s+Contact\s*:|$)/i);
    const cityStateMatch = sBlock.match(/([A-Za-z .]+,\s*(?:FL|Florida|GA|TX|CA|NY|NJ|PA|IL|NC|SC|OH|VA|TN)[,\s]*\d{5}?)/i);
    if (nameMatch && cityStateMatch) {
      origen = `${nameMatch[1].trim()} - ${cityStateMatch[1].trim()}`;
    } else if (addrMatch) {
      origen = addrMatch[1].trim();
    } else if (nameMatch) {
      origen = nameMatch[1].trim();
    } else if (cityStateMatch) {
      origen = cityStateMatch[1].trim();
    }
  }

  if (consigneeSectionMatch) {
    const cBlock = consigneeSectionMatch[1];
    const addrMatch = cBlock.match(/(?:Delivery|Consignee|Receiving|Shipping)\s*Address\s*[:\-]\s*([^\n\r]+?)(?=\s+Weight\s*:|\s+Description|\s+Date\s*:|$)/i);
    const nameMatch = cBlock.match(/Name\s*[:\-]\s*([^\n\r]+?)(?=\s+Type\s*:|\s+Contact\s*:|$)/i);
    const cityStateMatch = cBlock.match(/([A-Za-z .]+,\s*(?:FL|Florida|GA|TX|CA|NY|NJ|PA|IL|NC|SC|OH|VA|TN)[,\s]*\d{5}?)/i);
    if (nameMatch && cityStateMatch) {
      destino = `${nameMatch[1].trim()} - ${cityStateMatch[1].trim()}`;
    } else if (addrMatch) {
      destino = addrMatch[1].trim();
    } else if (nameMatch) {
      destino = nameMatch[1].trim();
    } else if (cityStateMatch) {
      destino = cityStateMatch[1].trim();
    }
  }

  // Si no tenía formato Shipper 1 / Consignee 1, buscar Origin / Destination explícitos.
  // Incluye el formato típico de correo de broker: "PICKUP- FIT", "P/U : POMTOC",
  // "Delivery - 33166", "POD: Miami".
  const cleanPlace = (v) => /^\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(String(v || ''))
    ? '' // es una fecha ("Pickup: 11/06/2026"), no un lugar
    : String(v || '')
    .replace(/\*/g, '')
    .replace(/\s+(?:-\s*)?(?:delivery|deliver|drop|pod|weight|commodity|rate|chassis|tri-?axle|live load)\b.*$/i, '')
    .trim()
    .slice(0, 80);
  if (!origen) {
    const oMatch = primaryText.match(/(?:origin|origen|pickup\s*location|pickup\s*address|ship\s*from|pick\s*-?\s*up|p\/u|\bpu\b)\s*[:\-–]+\s*([^\n\r|]+)/i);
    if (oMatch) origen = cleanPlace(oMatch[1]);
  }
  if (!destino) {
    const dMatch = primaryText.match(/(?:destination|destino|delivery\s*location|delivery\s*address|deliver\s*to|delivery|\bpod\b|drop\s*off|entrega)\s*[:\-–]+\s*([^\n\r|]+)/i);
    if (dMatch) destino = cleanPlace(dMatch[1]);
  }

  // Solo si el PDF no tenía direcciones o no había PDF, usar el texto/asunto del correo
  if (!origen || !destino) {
    // Solo flechas explícitas (->, →) o " TO " en el ASUNTO. Antes se buscaba
    // " to " / " a " en todo el texto y "Average Days to Pay" salía como ruta.
    const routeSource = String(fallbackSubject || '');
    const arrowMatch =
      routeSource.match(/([A-Za-zÁÉÍÓÚÑáéíóúñ .]+(?:,\s*[A-Z]{2})?)\s*(?:->|→)\s*([A-Za-zÁÉÍÓÚÑáéíóúñ .]+(?:,\s*[A-Z]{2})?)/) ||
      routeSource.match(/([A-Za-z .]+(?:,\s*[A-Z]{2})?)\s+TO\s+([A-Za-z .]+(?:,\s*[A-Z]{2})?(?:\s*\d{5})?)/);
    if (arrowMatch) {
      if (!origen) {
        origen = arrowMatch[1]
          .replace(/^(re|fw|fwd|rate|load|trucky|carrier|de|from|asunto|subject)\s*[:\-]?\s*/gi, '')
          .trim()
          .slice(0, 60);
      }
      if (!destino) {
        destino = arrowMatch[2]
          .replace(/\b(trucky|carrier|broker|load|rate)\b.*$/gi, '')
          .trim()
          .slice(0, 60);
      }
    }
  }

  // 4. FECHAS (priorizar "Ship Date:", "Date: 04-15-2026" en el PDF sobre la fecha de envío del correo)
  let pickupDate = '';
  let deliveryDate = '';

  const shipDateMatch = primaryText.match(/Ship\s*Date\s*[:\-]\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  const sectionDates = [...primaryText.matchAll(/\bDate\s*[:\-]\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/gi)].map(m => m[1]);

  if (shipDateMatch) {
    pickupDate = normalizeToIsoDate(shipDateMatch[1]);
  } else if (sectionDates.length > 0) {
    pickupDate = normalizeToIsoDate(sectionDates[0]);
  }

  if (sectionDates.length > 1) {
    deliveryDate = normalizeToIsoDate(sectionDates[1]);
  } else if (pickupDate) {
    deliveryDate = pickupDate;
  }

  if (!pickupDate) {
    const pdfDates = primaryText.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g) || [];
    pickupDate = normalizeToIsoDate(pdfDates[0]) || '';
    deliveryDate = normalizeToIsoDate(pdfDates[1] || pdfDates[0]) || pickupDate;
  }

  // 5. CITAS / HORARIOS
  const timeMatches = primaryText.match(/\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm))\b/g) || [];
  const citasResumen = timeMatches.length > 0 ? timeMatches.slice(0, 2).join(' - ') : '';

  // 5b. F5 (QA): hora de recogida y de entrega (24 h o AM/PM) junto a "Pickup"/"Delivery".
  const horaJunto = (re) => {
    for (const m of primaryText.matchAll(re)) if (m[1]) return m[1].replace(/\s+/g, ' ').trim();
    return '';
  };
  const hora_recogida = horaJunto(/(?:pick\s*-?\s*up|p\/u)[^\d\n]{0,30}?(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s*(?:@|at)?\s*)?(\d{1,2}:\d{2}\s*(?:am|pm)?)/gi);
  const hora_entrega = horaJunto(/(?:delivery|deliver|drop\s*-?\s*off|entrega)[^\d\n]{0,30}?(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s*(?:@|at)?\s*)?(\d{1,2}:\d{2}\s*(?:am|pm)?)/gi);
  const equipoMatch = primaryText.match(/(?:equipment|equipo|container\s*type)\s*[:\-]\s*(.+?)(?=\s{2,}|\s+(?:miles|total|rate|notes|commodity|weight|payment)\b|[\n\r]|$)/i);
  const equipo = equipoMatch ? equipoMatch[1].trim().slice(0, 80) : '';
  const penMatch = primaryText.match(/(?:penalt(?:y|ies)|penalidad(?:es)?)\s*[:\-]?\s*(.+?)(?=\s{2,}|[\n\r]|$)/i);
  const penalidades = penMatch ? penMatch[1].split(/\s(?=(?:notes|miles|total\s*rate[^:]{0,15}|payment\s*terms|equipment|delivery(?:\s*date\/time)?|pickup(?:\s*date\/time)?|broker(?:\s*mc)?|carrier)\s*:)/i)[0].trim().slice(0, 160) : '';

  // 6. REFERENCIA / LOAD #
  const refMatch =
    primaryText.match(/(?:Load\s*#|Load\s*Number|W\/O|PO\s*Numbers?|Ref(?:erence)?\s*#)\s*[:\-]?\s*([A-Z0-9\-]{3,25})/i);
  const numero_referencia = refMatch ? refMatch[1].trim() : '';

  // 7. MILLAS
  let millas = 0;
  // "280 miles" o "Miles: 280" (antes solo se leía el primer formato)
  const milesMatch =
    primaryText.match(/([0-9]{2,4}(?:[.,][0-9]+)?)\s*(?:miles|millas|loaded\s*miles|\bmi\b)/i) ||
    primaryText.match(/(?:loaded\s*miles|miles|millas|distance|distancia)\s*[:\-]\s*([0-9]{2,4}(?:[.,][0-9]+)?)/i);
  if (milesMatch) {
    millas = Number(String(milesMatch[1]).replace(',', '.')) || 0;
  }
  if (!millas && origen && destino) {
    millas = estimateMilesBetween(origen, destino);
  }

  // 8. NOTAS LIMPIAS (solo notas operativas breves del documento si existen, sin pegar el hilo ni bloques largos)
  let notas = '';
  const shippingNoteMatch = primaryText.match(/Shipping\s*Note\s*[:\-]\s*([^\n\r]+)/i);
  const commodityMatch = primaryText.match(/Commodity\s*[:\-]\s*([^\n\r]+)/i);
  const noteParts = [];
  if (numero_referencia) noteParts.push(`Load #${numero_referencia}`);
  if (citasResumen) noteParts.push(`Cita: ${citasResumen}`);
  if (commodityMatch) noteParts.push(`Carga: ${commodityMatch[1].trim()}`);
  if (shippingNoteMatch) noteParts.push(shippingNoteMatch[1].trim());
  notas = noteParts.join(' · ').slice(0, 220);

  // Lo que no está en el documento queda VACÍO para que el dispatcher lo complete.
  // Antes se inventaban valores (Fort Lauderdale → Miami, 250 mi, $450).
  return {
    origen: origen || '',
    destino: destino || '',
    millas: millas || 0,
    tarifa_negociada: tarifa || 0,
    tarifa_ofrecida: tarifa || 0,
    fecha_carga: pickupDate,
    fecha_entrega: deliveryDate || pickupDate,
    citas: citasResumen,
    numero_referencia,
    broker_nombre: broker_nombre || '',
    notas,
    hora_recogida,
    hora_entrega,
    equipo,
    penalidades,
  };
}

/**
 * F4 (QA 17-nov): resumen del hilo para el Verificador. Por mensaje: remitente,
 * fecha y las primeras líneas útiles, sin el texto citado de respuestas
 * anteriores ("> ...", "On ... wrote:", "De: ... Enviado:"). Encabezados en inglés.
 */
export function summarizeThreadForChecker(msgs = [], { perMessage = 420, total = 1800 } = {}) {
  // Mismo criterio que la vista del hilo en Emails (lib/emailThread.js).
  const cortarCita = (body = '') => splitQuoted(body).nuevo.replace(/\s+/g, ' ').trim();
  const parts = msgs.map((m) => {
    const body = cortarCita(m.cuerpo || m.snippet || '');
    const corto = body.length > perMessage ? body.slice(0, perMessage).replace(/\s\S*$/, '') + '…' : body;
    return `From: ${m.remitente_nombre || ''} <${m.remitente_email || ''}>\nDate: ${m.fecha || ''}\n${corto}`;
  });
  let text = parts.join('\n---\n');
  if (text.length > total) text = text.slice(0, total).replace(/\s\S*$/, '') + '…';
  return text;
}

/**
 * F4 (QA): lo conversado en el hilo para las notas de la carga: remitente, fecha y
 * lo nuevo de cada mensaje (sin texto citado). El 1.º se omite si solo acompaña al PDF.
 */
export function resumenHiloParaNotas(threadMessages = [], { porMensaje = 160 } = {}) {
  const fechaCorta = (f) => {
    const d = new Date(f);
    if (!f || isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const respuestas = (threadMessages || [])
    .map((m) => ({
      quien: String(m.remitente_nombre || m.remitente_email || '').trim().split(/\s+/)[0],
      cuando: fechaCorta(m.fecha),
      texto: splitQuoted(m.cuerpo || m.snippet || '').nuevo.replace(/\s+/g, ' ').trim(),
    }))
    .filter((m, i) => m.texto && !(i === 0 && /\b(attached|attachment|adjunt)/i.test(m.texto)))
    .map((m) => `${m.quien}${m.cuando ? ` (${m.cuando})` : ''}: ${m.texto.length > porMensaje ? m.texto.slice(0, porMensaje).replace(/\s\S*$/, '') + '…' : m.texto}`);
  return respuestas.length ? `Hilo: ${respuestas.join(' | ')}` : '';
}

/**
 * Construye los campos limpios de la carga a partir de los datos verificados del documento PDF
 * (priorizando los datos extraídos del PDF sobre cualquier valor por defecto).
 */
export function buildThreadSummaryForLoad({ threadMessages = [], extracted = {}, rawDocumentText = '', emailSubject = '', brokerEmail = '' }) {
  const fullSource = rawDocumentText || threadMessages.map(m => `${m.asunto || ''}\n${m.cuerpo || m.snippet || ''}`).join('\n\n');

  const heur = extractLogisticsFieldsFromText(
    fullSource,
    emailSubject,
    threadMessages[0]?.remitente_nombre || brokerEmail
  );

  // Primero lo que extrajo el Verificador; si falta, lo que se lee del texto.
  // Antes se descartaban "Miami", "Tampa", $850 y 250 mi por considerarlos
  // valores de relleno, y se terminaban usando otros inventados.
  const pick = (a, b) => (a !== undefined && a !== null && String(a).trim() !== '' ? a : b);
  const origen = pick(extracted?.origen, heur.origen);
  const destino = pick(extracted?.destino, heur.destino);
  const pickupFecha = normalizeToIsoDate(extracted?.pickup_fecha) || heur.fecha_carga;
  const deliveryFecha = normalizeToIsoDate(extracted?.delivery_fecha) || heur.fecha_entrega || pickupFecha;
  const tarifaTotal = Number(extracted?.tarifa_total) > 0 ? Number(extracted.tarifa_total) : heur.tarifa_negociada;
  const millas = Number(extracted?.millas) > 0 ? Number(extracted.millas) : heur.millas;
  const brokerNombre = pick(extracted?.broker_nombre, heur.broker_nombre);
  const refNum =
    extracted?.load_number ||
    extracted?.reference_number ||
    heur.numero_referencia ||
    '';

  // F5 (QA): horas, equipo y penalidades también quedan en la carga.
  const horaDe = (h, fecha) => {
    const v = String(h || '').trim() || (String(fecha || '').match(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i)?.[0] || '');
    return /^(null|undefined|n\/a|not specified|no especificado)$/i.test(v) ? '' : v;
  };
  const horaRecogida = horaDe(extracted?.pickup_hora, extracted?.pickup_fecha) || heur.hora_recogida || '';
  const horaEntrega = horaDe(extracted?.delivery_hora, extracted?.delivery_fecha) || heur.hora_entrega || '';
  const limpio = (v) => (v && !/^(null|undefined|n\/a|not specified|no especificado)$/i.test(String(v).trim()) ? String(v).trim() : '');
  // QA: si el documento trae la línea "Equipment: …" completa se usa tal cual (conserva
  // tamaño, sobrepeso, tri-axle…); la IA separa tipo y tamaño y perdía esos detalles.
  const equipoIA = [limpio(extracted?.tipo_equipo), limpio(extracted?.tamano_contenedor)].filter(Boolean)
    .filter((v, i, arr) => arr.findIndex(x => x.toLowerCase().includes(v.toLowerCase()) || v.toLowerCase().includes(x.toLowerCase())) === i)
    .join(' · ');
  const equipo = limpio(heur.equipo) || equipoIA || '';
  const penalidades = limpio(extracted?.penalidades) || heur.penalidades || '';
  const citas = limpio(extracted?.appointment_window) || heur.citas || '';

  // F4 (QA): las notas llevan el resumen operativo (direcciones, fechas, citas), no solo "Load #".
  const cuando = (f, h) => [f, h].filter(Boolean).join(' ');
  const notas = [
    refNum && `Load #${refNum}`,
    origen && `Pickup: ${origen}${cuando(pickupFecha, horaRecogida) ? ` (${cuando(pickupFecha, horaRecogida)})` : ''}`,
    destino && `Delivery: ${destino}${cuando(deliveryFecha, horaEntrega) ? ` (${cuando(deliveryFecha, horaEntrega)})` : ''}`,
    citas && `Cita: ${citas}`,
    equipo && `Equipo: ${equipo}`,
    penalidades && `Penalidad: ${penalidades}`,
    heur.notas && heur.notas.replace(/^Load #[^·]*·?\s*/, ''),
    resumenHiloParaNotas(threadMessages),
  ].filter(Boolean).join(' · ').slice(0, 1000);

  return {
    origen,
    destino,
    millas,
    tarifa_negociada: tarifaTotal,
    tarifa_ofrecida: tarifaTotal,
    fecha_carga: pickupFecha,
    fecha_entrega: deliveryFecha,
    citas,
    numero_referencia: refNum,
    broker_nombre: brokerNombre,
    notas,
    hora_recogida: horaRecogida,
    hora_entrega: horaEntrega,
    equipo,
    penalidades,
  };
}


/**
 * ¿El documento es una confirmación (se puede crear carga) o una solicitud de
 * tarifa (todavía no hay carga)? Se usa el tipo que dio el Verificador y, como
 * respaldo, frases típicas del texto.
 * Devuelve: 'confirmation' | 'rate_request' | 'unknown'
 */
export function classifyLoadDocument(text = '', verifierType = '') {
  const t = String(text || '').toLowerCase();
  const v = String(verifierType || '').toLowerCase();
  if (/rate.?request|rate.?inquir|inquiry|quote|cotiza|solicitud|consulta/.test(v)) return 'rate_request';
  const confirmation = /rate\s*confirmation|rate\s*con\b|load\s*confirmation|carrier\s*confirmation|load\s*tender|confirmaci[oó]n\s*de\s*(tarifa|carga)|agreed\s*amount|carrier\s*pay|delivery\s*order/.test(t);
  const request = /rate\s*request|rate\s*inquir|\brfq\b|need\s*(trucking\s*)?rates?|best\s*rates?|please\s*(advise|quote|share)|can\s*you\s*(handle|do|quote)|how\s*much|cotizaci[oó]n|solicitud\s*de\s*tarifa|please\s*confirm\s*this\s*rate/.test(t);
  if (confirmation && !request) return 'confirmation';
  if (/confirmation|delivery_order|rate_con/.test(v) && !request) return 'confirmation';
  if (request) return 'rate_request';
  return 'unknown';
}

/**
 * H1 (QA): tipo de documento ANTES de analizarlo. El Verificador solo analiza
 * Rate Confirmations; lo demás se detiene con un motivo claro.
 * Mira primero el encabezado (primeros ~800 caracteres): gana el título que
 * aparece antes. Si no hay título, revisa todo el texto.
 * Devuelve: 'rate_confirmation' | 'bill_of_lading' | 'delivery_order' |
 *           'rate_request' | 'market_report' | 'unknown'
 */
export function detectDocumentType(text = '') {
  const full = String(text || '').toLowerCase();
  const head = full.slice(0, 800);
  const TITLES = [
    ['rate_confirmation', /rate\s*confirmation|load\s*confirmation|dispatch\s*confirmation|carrier\s*confirmation|load\s*tender|confirmaci[oó]n\s*de\s*(tarifa|carga|despacho)/],
    ['bill_of_lading', /bill\s*of\s*lading|straight\s*bill|\bb\/l\b|conocimiento\s*de\s*embarque/],
    ['delivery_order', /delivery\s*order|orden\s*de\s*entrega/],
    ['market_report', /trendlines|\bdat\b.*(spot|rates?)|spot\s*(market|rates?)\s*(report|trends?)|market\s*report/],
  ];
  let best = null;
  for (const [type, re] of TITLES) {
    const m = head.match(re);
    if (m && (best === null || m.index < best.index)) best = { type, index: m.index };
  }
  if (best) return best.type;

  if (classifyLoadDocument(full) === 'rate_request') return 'rate_request';
  if (/agreed\s*amount|carrier\s*pay|rate\s*con\b|line\s*haul/.test(full)) return 'rate_confirmation';
  for (const [type, re] of TITLES) if (re.test(full)) return type;
  return 'unknown';
}

/** M6 (QA): reemplaza "null"/"undefined" literales en todo el resultado del análisis. */
export function cleanNullStrings(value, label = 'No especificado') {
  if (typeof value === 'string') {
    return value
      .replace(/\b(null|undefined)\s*@\s*(null|undefined)\b/gi, label)
      .replace(/\b(null|undefined)\b/gi, label);
  }
  if (Array.isArray(value)) return value.map(v => cleanNullStrings(v, label));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanNullStrings(v, label)]));
  }
  return value;
}

/**
 * U3 (QA): reglas de riesgo que NO dependen de la IA ni del plan.
 * Penalidad, TONU no pagado y MC inválido se marcan como alerta crítica (❌)
 * y el veredicto nunca puede quedar en "Aceptar".
 */
const PENALTY_RE = /(penalt(y|ies)|penalidad(es)?|\bmulta(s)?\b|late\s*fee|liquidated\s*damages|charge\s*-?\s*back|\$?\s*\d[\d,.]*\s*(usd)?\s*(per|\/|por)\s*(hour|hr|hora)\s*(of\s*)?(delay|late|lateness|retraso|tardanza))/i;
const TONU_NOT_PAID_RE = /(tonu[^.\n]{0,40}(not\s*(be\s*)?(paid|payable|applicable)|no\s*(se\s*)?(paga|pagar|pagado|aplica)|n\/a|none|will\s*not)|\bno\s*tonu\b|sin\s*tonu|without\s*tonu)/i;

export function findRiskClauses(text = '') {
  const t = String(text || '');
  const risks = [];
  const pen = t.match(PENALTY_RE);
  if (pen) {
    // la línea completa donde aparece ("Late delivery penalty: $250 per hour of delay.")
    let line = (t.split(/\n|(?<=\.)\s+/).find(l => PENALTY_RE.test(l)) || pen[0]).trim();
    // QA: cortar en el monto ("…penalty: $150"); el PDF llega en una sola línea y antes
    // se colaba la frase siguiente ("Carrier agrees to transport…").
    const conMonto = line.match(/^.*?(?:penalt|penalidad|multa|late\s*fee|liquidated|charge\s*-?\s*back)[^$\d]*?\$\s*[\d,]+(?:\.\d{2})?(?:\s*(?:usd|per\s+(?:hour|hr|day|hora|d[ií]a)|\/\s*(?:hour|hr|day|h)))?/i);
    if (conMonto) line = conMonto[0];
    line = line.replace(/^(?:penalt(?:y|ies)|penalidad(?:es)?)\s*:\s*(?=.*(?:penalt|penalidad))/i, '').trim().slice(0, 160);
    risks.push({ key: 'clause', text: `❌ Penalidad: "${line}"` });
  }
  const tonu = t.match(TONU_NOT_PAID_RE);
  if (tonu) risks.push({ key: 'clause', text: `❌ TONU no pagado: "${tonu[0].trim()}" — sin protección si cancelan la carga` });
  for (const m of t.matchAll(/\bMC\s*(?:#|number|no\.?|num)?\s*[:\-]?\s*(\d{1,8})\b/gi)) {
    const d = m[1];
    if (d.length < 5 || /^0+$/.test(d) || /^(\d)\1+$/.test(d)) {
      risks.push({ key: 'broker', text: `❌ MC inválido (${d}) — no es un número real de FMCSA` });
      break;
    }
  }
  return risks;
}

export function applyRiskGuards(analysis, text = '') {
  if (!analysis) return analysis;
  const risks = findRiskClauses(text);
  if (risks.length === 0) return analysis;
  const a = { ...analysis, categorias: [...(analysis.categorias || [])] };
  for (const r of risks) {
    const i = a.categorias.findIndex(c => c.categoriaKey === r.key);
    if (i >= 0) {
      const c = a.categorias[i];
      const hallazgos = (c.hallazgos || []).filter(h => !/^✓\s*(TONU|MC|Sin cláusulas)/i.test(h));
      // F3 (QA): el servidor ya pudo poner "❌ Penalidad: X"; no repetirla con otra forma ("X." entre comillas).
      const etiqueta = r.text.split(':')[0];
      if (!hallazgos.some(h => h === r.text || h.startsWith(etiqueta + ':'))) hallazgos.unshift(r.text);
      a.categorias[i] = { ...c, semaforo: 'rojo', hallazgos };
    } else {
      a.categorias.push({
        categoriaKey: r.key,
        categoria: r.key === 'broker' ? 'Broker' : 'Cláusulas y Penalidades',
        semaforo: 'rojo',
        hallazgos: [r.text],
        recomendacion: 'No aceptar hasta corregir',
      });
    }
  }
  const yaTiene = (txt) => (a.alertas_criticas || []).some(x => x === txt || x.startsWith(txt.split(':')[0] + ':'));
  const alertas = new Set([...(a.alertas_criticas || []), ...risks.map(r => r.text).filter(txt => !yaTiene(txt))]);
  a.alertas_criticas = [...alertas];
  a.veredicto = 'No aceptar hasta corregir';
  a.semaforo_general = 'rojo';
  a.resumen_ejecutivo = `Alerta crítica: ${risks.map(r => r.text.replace(/^❌\s*/, '')).join(' · ')}. ${a.resumen_ejecutivo || ''}`.trim();
  return a;
}
