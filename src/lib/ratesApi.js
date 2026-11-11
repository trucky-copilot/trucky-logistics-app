// F6-01 · Fase D — acceso de la pantalla "Tarifas" a los datos.
// Lectura: directo de las tablas (Base44 solo deja leer a administradores).
// Escritura: SIEMPRE por funciones del servidor, que validan antes de guardar.
import { base44 } from '@/api/base44Client';

const PAGE = 500;

async function readAll(entity, sort = 'orden') {
  const out = [];
  for (let skip = 0; ; skip += PAGE) {
    const page = await base44.entities[entity].filter({}, sort, PAGE, skip);
    const rows = Array.isArray(page) ? page : [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function loadCatalog() {
  const [routes, zones, accessorials, aliases] = await Promise.all([
    readAll('RateRoute'), readAll('RateZone'), readAll('RateAccessorial'), readAll('RateAlias'),
  ]);
  return { routes, zones, accessorials, aliases };
}


async function invoke(fn, payload) {
  try {
    const res = await base44.functions.invoke(fn, payload);
    return res?.data ?? res;
  } catch (err) {
    const status = err?.response?.status ?? err?.status;
    // Errores de validación del servidor: se devuelven para mostrarlos en la revisión.
    if (Array.isArray(err?.response?.data?.errores)) return err.response.data;
    if (status === 404) throw new Error(`La función ${fn} aún no está publicada en Base44.`);
    if (status === 403) throw new Error('No tienes permisos de administrador para esta acción.');
    const msg = err?.response?.data?.error || err?.message || 'Error desconocido';
    throw new Error(msg);
  }
}

// Cambios manuales: changes = [{ key: <clave existente o null si es nuevo>, data: {...campos} }]
export const previewChanges = (entity, changes) => invoke('adminSaveRates', { action: 'preview', entity, changes });
export const applyChanges = (entity, changes, firma) => invoke('adminSaveRates', { action: 'apply', entity, changes, firma });

// Carga de Excel: el navegador manda las hojas como filas; el servidor valida y convierte.
export const previewExcel = (p) => invoke('adminSaveRates', { action: 'previewExcel', ...p });
export const applyExcel = (p) => invoke('adminSaveRates', { action: 'applyExcel', ...p });

// Migración inicial (fase B).
export const migrateRates = (action, extra = {}) => invoke('adminMigrateRates', { action, ...extra });


export const TAMANOS = [
  { id: '20', label: "20'" },
  { id: '40', label: "40'" },
  { id: '45', label: "45'" },
  { id: '20_heavy', label: "20' Heavy" },
];

export const money = (n) => (n == null || n === '' ? '—' : `$${Number(n).toLocaleString('en-US')}`);
