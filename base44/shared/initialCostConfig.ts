// Costos del registro inicial (Onboarding / usuario Demo).
// El registro inicial pide diésel, MPG y % del conductor; los costos fijos se
// estiman con los mismos valores de la Calculadora (src/lib/freight/costMath.js,
// FIXED_COST_DEFAULTS). Antes no se guardaba el costo por milla y el chat pedía
// "configura tu calculadora" aunque el usuario ya la había llenado al registrarse.
export const FIXED_COST_DEFAULTS = {
  seguro_semanal: 800,
  lease_semanal: 1200,
  otros_gastos_semanales: 300,
  millas_semana_promedio: 2500,
};

const num = (v: unknown) => {
  const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Si el registro no tiene costo por milla pero sí diésel, MPG y % del conductor,
 * lo completa con la misma fórmula de la Calculadora. Si ya tiene costo por milla
 * (el usuario guardó la Calculadora), se respeta tal cual.
 */
export function completarCostosIniciales(record: any): any {
  if (!record || record.costo_por_milla != null) return record;
  const diesel = num(record.diesel_precio), mpg = num(record.mpg), pct = num(record.pago_conductor_porcentaje);
  if (!(diesel > 0) || !(mpg > 0) || !(pct >= 0 && pct < 100)) return record;
  const val = (k: keyof typeof FIXED_COST_DEFAULTS) => {
    const n = num(record[k]);
    return Number.isFinite(n) ? n : FIXED_COST_DEFAULTS[k];
  };
  const millas = val('millas_semana_promedio');
  if (!(millas > 0)) return record;
  const fijo = (val('seguro_semanal') + val('lease_semanal') + val('otros_gastos_semanales')) / millas;
  const costo = diesel / mpg + fijo;
  if (!Number.isFinite(costo)) return record;
  return {
    ...record,
    costo_por_milla: Math.round(costo * 100) / 100,
    tarifa_break_even: record.tarifa_break_even ?? Math.round((costo / (1 - pct / 100)) * 100) / 100,
  };
}
