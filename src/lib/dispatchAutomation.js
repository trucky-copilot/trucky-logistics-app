/**
 * Utilidad compartida para el flujo de Automatización de Despacho en Trucky:
 * 1) Email (Adjunto PDF + Hilo) -> Verificador de Documentos (/documentos)
 * 2) Crear Carga en Mis Cargas (/cargas) con datos extraídos fielmente del PDF/Rate Confirmation
 * 3) Flota (/flota) -> Botón en la esquina superior junto a "+ Agregar camión" para elegir conductor disponible
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
  if (!oCoord || !dCoord) return 250;
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
    }
  }

  // Si no tenía formato Shipper 1 / Consignee 1, buscar Origin / Destination explícitos
  if (!origen) {
    const oMatch = primaryText.match(/(?:origin|origen|pickup\s*location|pickup\s*address|ship\s*from)\s*[:\-]\s*([^\n\r|]+)/i);
    if (oMatch) origen = oMatch[1].trim().slice(0, 80);
  }
  if (!destino) {
    const dMatch = primaryText.match(/(?:destination|destino|delivery\s*location|delivery\s*address|deliver\s*to)\s*[:\-]\s*([^\n\r|]+)/i);
    if (dMatch) destino = dMatch[1].trim().slice(0, 80);
  }

  // Solo si el PDF no tenía direcciones o no había PDF, usar el texto/asunto del correo
  if (!origen || !destino) {
    const combinedForRoute = `${primaryText}\n${threadOnlyText}\n${fallbackSubject}`;
    const arrowMatch = combinedForRoute.match(/([A-Za-zÁÉÍÓÚÑáéíóúñ .]+(?:,\s*[A-Z]{2})?)\s*(?:->|→|\ba\b|\bto\b)\s*([A-Za-zÁÉÍÓÚÑáéíóúñ .]+(?:,\s*[A-Z]{2})?)/i);
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
    pickupDate = normalizeToIsoDate(pdfDates[0]) || new Date().toISOString().slice(0, 10);
    deliveryDate = normalizeToIsoDate(pdfDates[1] || pdfDates[0]) || pickupDate;
  }

  // 5. CITAS / HORARIOS
  const timeMatches = primaryText.match(/\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm))\b/g) || [];
  const citasResumen = timeMatches.length > 0 ? timeMatches.slice(0, 2).join(' - ') : '';

  // 6. REFERENCIA / LOAD #
  const refMatch =
    primaryText.match(/(?:Load\s*#|Load\s*Number|W\/O|PO\s*Numbers?|Ref(?:erence)?\s*#)\s*[:\-]?\s*([A-Z0-9\-]{3,25})/i);
  const numero_referencia = refMatch ? refMatch[1].trim() : '';

  // 7. MILLAS
  let millas = 0;
  const milesMatch = primaryText.match(/([0-9]{2,4}(?:[.,][0-9]+)?)\s*(?:miles|millas|loaded\s*miles|\bmi\b)/i);
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

  return {
    origen: origen || 'Fort Lauderdale, FL',
    destino: destino || 'Miami, FL',
    millas: millas || 250,
    tarifa_negociada: tarifa || 450,
    tarifa_ofrecida: tarifa || 450,
    fecha_carga: pickupDate,
    fecha_entrega: deliveryDate || pickupDate,
    citas: citasResumen,
    numero_referencia,
    broker_nombre: broker_nombre || 'Broker',
    notas,
  };
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

  // Priorizar los datos que vinieron del PDF (heur) si el LLM devolvió valores genéricos o vacíos
  const origen = (extracted?.origen && !/miami/i.test(extracted.origen)) ? extracted.origen : (heur.origen || extracted?.origen);
  const destino = (extracted?.destino && !/tampa/i.test(extracted.destino)) ? extracted.destino : (heur.destino || extracted?.destino);
  const pickupFecha = normalizeToIsoDate(extracted?.pickup_fecha) || heur.fecha_carga;
  const deliveryFecha = normalizeToIsoDate(extracted?.delivery_fecha) || heur.fecha_entrega || pickupFecha;
  const tarifaTotal = Number(extracted?.tarifa_total) > 0 && Number(extracted?.tarifa_total) !== 850
    ? Number(extracted.tarifa_total)
    : (heur.tarifa_negociada || Number(extracted?.tarifa_total) || 450);
  const millas = Number(extracted?.millas) > 0 && Number(extracted?.millas) !== 250
    ? Number(extracted.millas)
    : (heur.millas || Number(extracted?.millas) || 250);
  const brokerNombre = (extracted?.broker_nombre && !/trucky\s*app|broker/i.test(extracted.broker_nombre))
    ? extracted.broker_nombre
    : (heur.broker_nombre || extracted?.broker_nombre || 'Broker');
  const refNum =
    extracted?.load_number ||
    extracted?.reference_number ||
    heur.numero_referencia ||
    '';

  return {
    origen,
    destino,
    millas,
    tarifa_negociada: tarifaTotal,
    tarifa_ofrecida: tarifaTotal,
    fecha_carga: pickupFecha,
    fecha_entrega: deliveryFecha,
    citas: heur.citas || '',
    numero_referencia: refNum,
    broker_nombre: brokerNombre,
    notas: heur.notas || '',
  };
}
