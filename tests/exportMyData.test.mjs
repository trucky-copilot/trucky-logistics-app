import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExport, exportFileName } from '../src/lib/exportMyData.js';
import { supportMailto, legalUrl } from '../src/lib/support.js';

test('F3-15 · Descargar mis datos: incluye cada colección y quita tokens y secretos', () => {
  const d = buildExport({
    email: 'a@b.com', empresa: { id: 'o1', name: 'Truck USA', stripe_live_customer_id: 'cus_x' },
    perfil: { nombre_completo: 'Luis', gmail_token: 'x', refresh_token: 'y' },
    cargas: [{ id: 'l1', origen: 'Miami', access_token: 'z' }], brokers: [{ id: 'b1' }], camiones: [], conductores: [{ id: 'd1', api_secret: 's' }],
  }, new Date('2026-11-20T10:00:00Z'));
  assert.deepEqual(d.empresa, { id: 'o1', nombre: 'Truck USA' });
  assert.deepEqual(d.perfil, { nombre_completo: 'Luis' });
  assert.deepEqual(d.cargas, [{ id: 'l1', origen: 'Miami' }]);
  assert.deepEqual(d.conductores, [{ id: 'd1' }]);
  assert.equal(d.generado, '2026-11-20T10:00:00.000Z');
  assert.equal(exportFileName(new Date('2026-11-20T10:00:00Z')), 'trucky-mis-datos-2026-11-20.json');
});

test('F3-15 · Soporte y documentos legales', () => {
  assert.equal(legalUrl('terms', 'en'), 'https://www.trucky-ai.com/terms?lang=en');
  assert.equal(legalUrl('privacy', 'es'), 'https://www.trucky-ai.com/privacy?lang=es');
  const m = supportMailto({ locale: 'es', email: 'a@b.com' });
  assert.match(m, /^mailto:trucky\.road\.copilot@gmail\.com\?subject=Soporte%20Trucky&body=/);
  assert.match(decodeURIComponent(m), /Cuenta: a@b\.com/);
});
