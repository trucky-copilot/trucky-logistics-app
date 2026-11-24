// F3-15 fase 7: preferencias de Accesibilidad y Notificaciones.
// Se guardan en este navegador (igual que el tema) y se aplican al instante.
export const PREFS_KEY = 'trucky-prefs';
export const PREFS_EVENT = 'trucky-prefs-updated';

export const DEFAULT_PREFS = {
  accesibilidad: {
    tamano_texto: 'normal', // 'normal' | 'grande' | 'muy_grande'
    reducir_movimiento: false,
    alto_contraste: false,
  },
  notificaciones: {
    // Qué módulos generan avisos en la campana, el Dashboard y Notificaciones.
    flota: true,
    conductores: true,
    brokers: true,
    cargas: true,
    sistema: true,
    // Días de anticipación para avisar documentos de conductores por vencer.
    dias_vencimiento: 60,
  },
};

export const TEXT_SIZES = { normal: '100%', grande: '112.5%', muy_grande: '125%' };
export const EXPIRY_DAYS = [7, 15, 30, 60];

const storage = () => {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};

export function readPrefs() {
  let saved = {};
  try { saved = JSON.parse(storage()?.getItem(PREFS_KEY) || '{}') || {}; } catch { saved = {}; }
  return {
    accesibilidad: { ...DEFAULT_PREFS.accesibilidad, ...(saved.accesibilidad || {}) },
    notificaciones: { ...DEFAULT_PREFS.notificaciones, ...(saved.notificaciones || {}) },
  };
}

export function savePrefs(next) {
  try { storage()?.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* navegador sin almacenamiento */ }
  if (typeof window !== 'undefined') {
    applyAccessibility(next.accesibilidad);
    window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: next }));
    // La campana y el Dashboard recalculan sus avisos.
    window.dispatchEvent(new CustomEvent('notifications-updated'));
  }
  return next;
}

/** Aplica tamaño de texto, reducir movimiento y alto contraste sobre <html>. */
export function applyAccessibility(a = DEFAULT_PREFS.accesibilidad) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.fontSize = TEXT_SIZES[a.tamano_texto] || '100%';
  root.classList.toggle('reduce-motion', Boolean(a.reducir_movimiento));
  root.classList.toggle('high-contrast', Boolean(a.alto_contraste));
}

/**
 * Filtra los avisos según las preferencias: módulos apagados y documentos que
 * vencen más allá de los días elegidos. Solo oculta; no borra nada.
 */
export function applyAlertPrefs(alerts = [], n = DEFAULT_PREFS.notificaciones) {
  return alerts.filter((a) => {
    if (a.modulo && n[a.modulo] === false) return false;
    if (typeof a.diasParaVencer === 'number' && a.diasParaVencer > Number(n.dias_vencimiento || 60)) return false;
    return true;
  });
}
