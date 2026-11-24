// F3-15 fase 7: preferencias de Notificaciones aplicadas a los avisos operativos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getOperationalAlerts } from '../src/lib/operationalAlerts.js';
import { applyAlertPrefs, readPrefs, DEFAULT_PREFS } from '../src/lib/userPreferences.js';

const enDias = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
const datos = {
  drivers: [{ id: 'd1', nombre: 'Ana', medico_vencimiento: enDias(20), twic_vencimiento: enDias(-3) }],
  trucks: [{ id: 't1', placa: 'FL-1', estado: 'mantenimiento' }],
  loads: [{ id: 'l1', estado: 'pendiente', origen: 'Miami', destino: 'Tampa' }],
};

test('sin preferencias guardadas se comporta igual que antes (60 días, todo activo)', () => {
  assert.deepEqual(readPrefs(), DEFAULT_PREFS);
  const ids = getOperationalAlerts(datos).map(a => a.id);
  assert.ok(ids.includes('driver-doc-soon-d1-medico_vencimiento'));
  assert.ok(ids.includes('truck-maint-t1'));
  assert.ok(ids.includes('load-pending-l1'));
});

test('apagar un módulo solo oculta sus avisos', () => {
  const prefs = { ...DEFAULT_PREFS.notificaciones, flota: false, cargas: false };
  const mods = new Set(getOperationalAlerts({ ...datos, prefs }).map(a => a.modulo));
  assert.deepEqual([...mods], ['conductores']);
});

test('días de anticipación: un documento que vence en 20 días no se avisa con 15; los vencidos siempre', () => {
  const ids = getOperationalAlerts({ ...datos, prefs: { ...DEFAULT_PREFS.notificaciones, dias_vencimiento: 15 } }).map(a => a.id);
  assert.ok(!ids.includes('driver-doc-soon-d1-medico_vencimiento'));
  assert.ok(ids.includes('driver-doc-exp-d1-twic_vencimiento'));
  const con30 = applyAlertPrefs([{ id: 'x', modulo: 'conductores', diasParaVencer: 20 }], { ...DEFAULT_PREFS.notificaciones, dias_vencimiento: 30 });
  assert.equal(con30.length, 1);
});
