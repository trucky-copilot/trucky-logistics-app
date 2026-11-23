// Corte semanal y archivo mensual de Cargas. No mueve ni borra registros:
// solo decide qué cargas se ven en cada periodo. La ganancia usa el mismo
// cálculo de siempre (loadRate.js).
import { effectiveRate, effectiveProfit } from './loadRate.js';

/** Fecha de la carga: la de recogida ("YYYY-MM-DD", en hora local) o, si no hay, la de creación. */
export function loadDate(load) {
  const f = String(load?.fecha_carga || '').trim();
  const m = f.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const c = load?.created_date ? new Date(load.created_date) : null;
  return c && !isNaN(c) ? c : null;
}

/** Semana de lunes 00:00 a lunes siguiente. offset -1 = semana anterior. */
export function weekRange(date = new Date(), offset = 0) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

export function monthRange(year, month) {
  return { start: new Date(year, month, 1), end: new Date(year, month + 1, 1) };
}

export function inRange(load, { start, end }) {
  const d = loadDate(load);
  return Boolean(d) && d >= start && d < end;
}

/** Meses con cargas (más el actual), del más reciente al más antiguo. */
export function availableMonths(loads = [], today = new Date()) {
  const keys = new Set([`${today.getFullYear()}-${today.getMonth()}`]);
  for (const l of loads) {
    const d = loadDate(l);
    if (d) keys.add(`${d.getFullYear()}-${d.getMonth()}`);
  }
  return [...keys]
    .map(k => { const [y, m] = k.split('-').map(Number); return { year: y, month: m }; })
    .sort((a, b) => (b.year - a.year) || (b.month - a.month));
}

/** Un mes está cerrado (archivado) cuando ya terminó. */
export function isMonthClosed(year, month, today = new Date()) {
  return monthRange(year, month).end <= new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

/** Totales del periodo: ingresos, cargas, millas, $/mi y ganancia. */
export function periodTotals(loads = []) {
  const revenue = loads.reduce((s, l) => s + effectiveRate(l), 0);
  const miles = loads.reduce((s, l) => s + (Number(l.millas) || 0), 0);
  const profit = loads.reduce((s, l) => s + effectiveProfit(l), 0);
  return { count: loads.length, revenue, miles, rpm: miles > 0 ? revenue / miles : 0, profit };
}

/**
 * Cargas e ingresos por semana (la actual primero) para el sensor de mercado del
 * chat: compara la semana actual con el promedio de las anteriores.
 */
export function weeklyStats(loads = [], weeks = 8, today = new Date()) {
  const rows = [];
  for (let i = 0; i < weeks; i++) {
    const range = weekRange(today, -i);
    const t = periodTotals(loads.filter(l => inRange(l, range)));
    rows.push({ start: range.start, end: range.end, count: t.count, revenue: t.revenue });
  }
  const prev = rows.slice(1).filter(r => r.count > 0);
  const avgCount = prev.length ? prev.reduce((s, r) => s + r.count, 0) / prev.length : 0;
  // La semana actual va a medias: se compara con lo esperado según los días transcurridos.
  const elapsed = Math.min(1, Math.max(1 / 7, (today - rows[0].start) / (7 * 86400000)));
  const expected = avgCount * elapsed;
  return { weeks: rows, avgCount, expected, slowWeek: expected > 0 && rows[0].count < expected * 0.6 };
}
