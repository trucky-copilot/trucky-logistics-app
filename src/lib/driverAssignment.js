/**
 * Asignación de conductor a carga — lógica compartida por Cargas y Flota.
 *
 * Reglas del ticket:
 *  - La relación carga–conductor va por ID (conductor_id / truck_id), no por texto.
 *  - Solo conductores del carrier activo (= perfil activo). Nunca de otro perfil.
 *  - El correo NO se envía solo: se prepara un borrador para Broker y Carrier.
 *
 * "Disponible" (definición propuesta, por validar con Producto):
 *  conductor con estado activo (o sin estado) que NO tiene otra carga en tránsito.
 */
import { AUTOMATION_FLEET_TO_EMAIL_DRAFT_KEY } from '@/lib/dispatchAutomation';
import { effectiveRate } from '@/lib/loadRate';

const DOCS = [
  { field: 'twic_vencimiento', es: 'TWIC', en: 'TWIC' },
  { field: 'licencia_vencimiento', es: 'Licencia', en: 'License' },
  { field: 'medico_vencimiento', es: 'Examen médico', en: 'Medical card' },
  { field: 'hazmat_vencimiento', es: 'Hazmat', en: 'Hazmat' },
];

/** Solo registros del perfil activo (por profile_id o, en datos viejos, por la lista local). */
export function onlyActiveProfile(items, activeProfileId, legacyIds) {
  return (items || []).filter(item => {
    if (item.profile_id) return String(item.profile_id) === String(activeProfileId);
    return Boolean(legacyIds && legacyIds.includes(item.id));
  });
}

/** Documentos vencidos o por vencer (≤ 30 días). */
export function getDriverDocIssues(driver, isEs = true, today = new Date()) {
  const issues = [];
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (const doc of DOCS) {
    const raw = driver?.[doc.field];
    if (!raw) continue;
    const d = new Date(`${String(raw).slice(0, 10)}T00:00:00`);
    if (isNaN(d)) continue;
    const days = Math.round((d - start) / 86400000);
    const label = isEs ? doc.es : doc.en;
    if (days < 0) {
      issues.push({ level: 'expired', label, date: String(raw).slice(0, 10),
        text: isEs ? `${label} vencido (${String(raw).slice(0, 10)})` : `${label} expired (${String(raw).slice(0, 10)})` });
    } else if (days <= 30) {
      issues.push({ level: 'soon', label, date: String(raw).slice(0, 10),
        text: isEs ? `${label} vence en ${days} días` : `${label} expires in ${days} days` });
    }
  }
  return issues;
}

/** Camión del conductor: por truck_asignado (placa) o por conductor_asignado (ID). */
function findDriverTruck(driver, trucks) {
  return (trucks || []).find(tr =>
    (tr.conductor_asignado && String(tr.conductor_asignado) === String(driver.id)) ||
    (driver.truck_asignado && String(driver.truck_asignado).toLowerCase() === String(tr.placa || '').toLowerCase())
  ) || null;
}

/**
 * Opciones de conductor para una carga. `currentLoadId` permite que el conductor
 * ya asignado a ESTA carga siga apareciendo aunque esté en tránsito con ella.
 */
export function buildDriverOptions({ drivers, trucks, loads, currentLoadId = null, isEs = true }) {
  const busy = new Set(
    (loads || [])
      .filter(l => l.estado === 'en_transito' && l.conductor_id && l.id !== currentLoadId)
      .map(l => String(l.conductor_id))
  );
  return (drivers || [])
    .filter(d => !d.estado || d.estado === 'activo')
    .map(d => {
      const truck = findDriverTruck(d, trucks);
      return {
        id: d.id,
        name: `${d.nombre || ''} ${d.apellido || ''}`.trim() || (isEs ? 'Sin nombre' : 'No name'),
        phone: d.telefono || '',
        license: d.licencia_numero || '',
        truckId: truck?.id || null,
        placa: truck?.placa || d.truck_asignado || '',
        busy: busy.has(String(d.id)),
        issues: getDriverDocIssues(d, isEs),
      };
    })
    .filter(o => !o.busy);
}

function formatDate(raw, isEs) {
  if (!raw) return isEs ? 'Por confirmar' : 'To be confirmed';
  const d = new Date(`${String(raw).slice(0, 10)}T00:00:00`);
  if (isNaN(d)) return String(raw);
  return d.toLocaleDateString(isEs ? 'es-CO' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Borrador para Broker y Carrier con los datos reales del conductor y las fechas. */
export function buildDispatchDraft(load, option, isEs = true) {
  const ref = load.numero_referencia ? ` (Ref: ${load.numero_referencia})` : '';
  const na = isEs ? 'No registrado' : 'Not on file';
  const subject = `${isEs ? 'Confirmación de Despacho' : 'Dispatch Confirmation'}: ${load.origen} → ${load.destino}${ref}`;
  // Negociada o, si falta, la ofrecida (QA: decía "Tarifa acordada: $0")
  const rate = effectiveRate(load) > 0
    ? `$${effectiveRate(load).toLocaleString('en-US')}`
    : (isEs ? 'Por confirmar' : 'To be confirmed');
  const body = isEs
    ? `Hola equipo (${load.broker_nombre || 'Broker'} & Carrier),\n\n` +
      `Confirmamos la asignación de conductor y unidad para la carga:\n\n` +
      `• Ruta: ${load.origen} → ${load.destino} (${load.millas || '--'} millas)\n` +
      `• Fecha de recogida (Pickup): ${formatDate(load.fecha_carga, true)}\n` +
      `• Fecha de entrega (Delivery): ${formatDate(load.fecha_entrega, true)}\n` +
      (load.numero_referencia ? `• Load # / Referencia: ${load.numero_referencia}\n` : '') +
      `• Tarifa acordada: ${rate}\n\n` +
      `DATOS DEL CONDUCTOR ASIGNADO:\n` +
      `• Conductor: ${option.name}\n` +
      `• Teléfono: ${option.phone || na}\n` +
      `• Licencia: ${option.license || na}\n` +
      `• Camión / Placa: ${option.placa || na}\n` +
      `\nSaludos cordiales,\nDepartamento de Despacho — Trucky`
    : `Hello team (${load.broker_nombre || 'Broker'} & Carrier),\n\n` +
      `We confirm the driver and unit assignment for the load:\n\n` +
      `• Route: ${load.origen} → ${load.destino} (${load.millas || '--'} miles)\n` +
      `• Pickup date: ${formatDate(load.fecha_carga, false)}\n` +
      `• Delivery date: ${formatDate(load.fecha_entrega, false)}\n` +
      (load.numero_referencia ? `• Load # / Reference: ${load.numero_referencia}\n` : '') +
      `• Agreed rate: ${rate}\n\n` +
      `ASSIGNED DRIVER DETAILS:\n` +
      `• Driver: ${option.name}\n` +
      `• Phone: ${option.phone || na}\n` +
      `• License: ${option.license || na}\n` +
      `• Truck / Plate: ${option.placa || na}\n` +
      `\nBest regards,\nDispatch Department — Trucky`;
  return { subject, body };
}

/** Campos que se guardan en la carga al asignar (relación por ID). */
export function assignmentFields(option) {
  if (!option) return { conductor_id: null, conductor_nombre: '', truck_id: null, truck_placa: '' };
  return {
    conductor_id: option.id,
    conductor_nombre: option.name, // copia solo para mostrar; la relación es conductor_id
    truck_id: option.truckId,
    truck_placa: option.placa || '',
  };
}

/** Deja el borrador listo para que Emails lo abra (NO lo envía). */
export function storeDispatchDraft({ load, option, carrierEmail, isEs }) {
  const { subject, body } = buildDispatchDraft(load, option, isEs);
  sessionStorage.setItem(AUTOMATION_FLEET_TO_EMAIL_DRAFT_KEY, JSON.stringify({
    loadId: load.id,
    origen: load.origen,
    destino: load.destino,
    brokerEmail: load.broker_email || '',
    carrierEmail: carrierEmail || load.carrier_email || '',
    conductorNombre: option.name,
    truckPlaca: option.placa || '',
    subject,
    content: body,
    threadId: load.thread_id || null,
  }));
}
