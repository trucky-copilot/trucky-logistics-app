// F3-15 · Fase 6 — "Descargar mis datos": arma un archivo JSON con los datos de la
// cuenta y de la empresa que el usuario puede ver. No incluye correos ni el chat.

const QUITAR = new Set(['created_by', 'created_by_id', 'is_sample', 'oauth_token', 'access_token', 'refresh_token', 'gmail_token']);

function limpiar(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) =>
    Object.fromEntries(Object.entries(r || {}).filter(([k]) => !QUITAR.has(k) && !/token|secret|password/i.test(k))));
}

/** Construye el objeto exportado a partir de las colecciones ya leídas. */
export function buildExport({ email = '', empresa = null, perfil = null, costos = [], plantillas = [], cargas = [], brokers = [], camiones = [], conductores = [] }, now = new Date()) {
  return {
    generado: now.toISOString(),
    cuenta: email,
    empresa: empresa ? { id: empresa.id, nombre: empresa.name || null } : null,
    perfil: perfil ? limpiar([perfil])[0] : null,
    costos: limpiar(costos),
    plantillas_correo: limpiar(plantillas),
    cargas: limpiar(cargas),
    brokers: limpiar(brokers),
    flota: limpiar(camiones),
    conductores: limpiar(conductores),
  };
}

export const exportFileName = (now = new Date()) => `trucky-mis-datos-${now.toISOString().slice(0, 10)}.json`;

/** Lee todo (base44 + organización) y descarga el archivo. */
export async function downloadMyData({ base44, email, organization }) {
  const orgId = organization?.id || null;
  const porOrg = (ent) => (orgId ? ent.filter({ organization_id: orgId }).catch(() => []) : Promise.resolve([]));
  const porUsuario = (ent) => ent.filter({ usuario: email }).catch(() => []);
  const E = base44.entities;
  const [perfiles, costos, plantillas, cargas, brokers, camiones, conductores] = await Promise.all([
    porUsuario(E.UserProfile), porUsuario(E.CostConfig), porUsuario(E.EmailTemplate),
    porOrg(E.Load), porOrg(E.Broker), porOrg(E.Truck), porOrg(E.Driver),
  ]);
  const now = new Date();
  const data = buildExport({ email, empresa: organization, perfil: perfiles?.[0] || null, costos, plantillas, cargas, brokers, camiones, conductores }, now);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = exportFileName(now);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { total: data.cargas.length + data.brokers.length + data.flota.length + data.conductores.length };
}
