// QA 3-nov-2026: una notificación por cada documento del conductor.
import test from 'node:test'; import assert from 'node:assert/strict';
import { getOperationalAlerts } from '../src/lib/operationalAlerts.js';

const RealDate = Date;
function withToday(iso, fn) {
  const fixed = new RealDate(`${iso}T12:00:00`).getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  try { return fn(); } finally { globalThis.Date = RealDate; }
}
const qa = { id: 'd1', nombre: 'QA Conductor', apellido: 'Uno', estado: 'activo',
  licencia_vencimiento: '2026-10-01', twic_vencimiento: '2026-10-20', medico_vencimiento: '2026-11-10' };
const docs = (alerts) => alerts.filter((a) => a.modulo === 'conductores').map((a) => `${a.nivel}:${a.mensaje.split(':')[0]}`).sort();

test('caso QA: licencia vencida + TWIC vencido + médico por vencer → 3 notificaciones', () => {
  const alerts = withToday('2026-11-04', () => getOperationalAlerts({ drivers: [qa] }));
  assert.deepEqual(docs(alerts), ['amarillo:Médico', 'rojo:Licencia', 'rojo:TWIC']);
  assert.equal(alerts.find((a) => a.id === 'driver-doc-soon-d1-medico_vencimiento').mensaje, 'Médico: vence en 6d (2026-11-10)');
  assert.equal(alerts.find((a) => a.id === 'driver-doc-exp-d1-licencia_vencimiento').mensaje, 'Licencia: VENCIDO hace 34d (2026-10-01)');
});
test('al actualizar la licencia solo desaparece su notificación; las otras siguen igual', () => {
  const antes = withToday('2026-11-04', () => getOperationalAlerts({ drivers: [qa] })).map((a) => a.id);
  const despues = withToday('2026-11-04', () => getOperationalAlerts({ drivers: [{ ...qa, licencia_vencimiento: '2027-10-01' }] })).map((a) => a.id);
  assert.deepEqual(antes.filter((id) => !id.includes('licencia')).sort(), despues.sort());
});
test('los ids no se repiten (no se duplica al recargar)', () => {
  const ids = withToday('2026-11-04', () => getOperationalAlerts({ drivers: [qa, { ...qa, id: 'd2' }] })).map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
});
test('documentos al día o a más de 60 días no generan notificación; de vacaciones también avisa documentos', () => {
  const ok = withToday('2026-11-04', () => getOperationalAlerts({ drivers: [{ id: 'd3', nombre: 'Ok', estado: 'activo', licencia_vencimiento: '2027-06-01' }] }));
  assert.equal(ok.length, 0);
  const vac = withToday('2026-11-04', () => getOperationalAlerts({ drivers: [{ ...qa, estado: 'vacaciones' }] }));
  assert.equal(vac.filter((a) => a.modulo === 'conductores').length, 4);
});
test('conductor suspendido: sigue mostrando solo la suspensión (sin cambios)', () => {
  const s = withToday('2026-11-04', () => getOperationalAlerts({ drivers: [{ ...qa, estado: 'suspension' }] }));
  assert.deepEqual(s.map((a) => a.mensaje), ['Conductor suspendido']);
});
