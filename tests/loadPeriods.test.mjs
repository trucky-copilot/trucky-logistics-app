// Corte semanal y archivo mensual de Cargas (no se borran registros; misma ganancia).
import test from 'node:test';
import assert from 'node:assert/strict';
import { weekRange, monthRange, inRange, loadDate, availableMonths, isMonthClosed, periodTotals, weeklyStats } from '../src/lib/loadPeriods.js';

const hoy = new Date(2026, 10, 25, 10); // miércoles 25-nov-2026

test('la semana va de lunes a lunes y la anterior es la de antes', () => {
  const w = weekRange(hoy, 0);
  assert.equal(w.start.getDay(), 1); assert.equal(w.start.getDate(), 23);
  assert.equal(w.end.getDate(), 30);
  assert.equal(weekRange(hoy, -1).start.getDate(), 16);
});

test('la fecha de recogida se lee en hora local (no se corre al día anterior)', () => {
  const d = loadDate({ fecha_carga: '2026-12-02' });
  assert.equal(d.getDate(), 2); assert.equal(d.getMonth(), 11);
  assert.ok(loadDate({ created_date: '2026-11-20T15:00:00Z' }));
});

test('semana nueva sin cargas arranca en cero; la anterior conserva las suyas', () => {
  const loads = [
    { fecha_carga: '2026-11-17', tarifa_negociada: 1000, millas: 200 },
    { fecha_carga: '2026-11-20', tarifa_negociada: 500, millas: 100 },
  ];
  assert.equal(periodTotals(loads.filter(l => inRange(l, weekRange(hoy, 0)))).count, 0);
  const prev = periodTotals(loads.filter(l => inRange(l, weekRange(hoy, -1))));
  assert.equal(prev.count, 2); assert.equal(prev.revenue, 1500); assert.equal(prev.rpm, 5);
});

test('meses del historial y mes cerrado', () => {
  const m = availableMonths([{ fecha_carga: '2026-10-05' }, { fecha_carga: '2026-11-02' }], hoy);
  assert.deepEqual(m, [{ year: 2026, month: 10 }, { year: 2026, month: 9 }]);
  assert.equal(isMonthClosed(2026, 9, hoy), true);
  assert.equal(isMonthClosed(2026, 10, hoy), false);
  assert.equal(inRange({ fecha_carga: '2026-10-31' }, monthRange(2026, 9)), true);
  assert.equal(inRange({ fecha_carga: '2026-11-01' }, monthRange(2026, 9)), false);
});

test('la ganancia del periodo usa la ganancia guardada de cada carga', () => {
  const t = periodTotals([{ tarifa_negociada: 1000, ganancia_estimada: 600 }, { tarifa_negociada: 800, ganancia_estimada: -50 }]);
  assert.equal(t.profit, 550);
});

test('sensor de mercado: detecta una semana lenta frente al promedio', () => {
  const loads = [];
  for (let w = 1; w <= 4; w++) for (let i = 0; i < 5; i++) {
    const d = weekRange(hoy, -w).start; d.setDate(d.getDate() + i);
    loads.push({ fecha_carga: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, tarifa_negociada: 1000 });
  }
  const s = weeklyStats(loads, 8, new Date(2026, 10, 29, 20)); // domingo, semana actual sin cargas
  assert.equal(s.avgCount, 5);
  assert.equal(s.slowWeek, true);
});
