// PM-03: enlace de invitación personal.
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { normalizarCodigo, leerInvitacion, borrarInvitacion, nuevoCodigo, enlaceInvitacion, datosInvitado, CODIGO_VALIDO } = await import('../src/lib/invite.js');

test('código nuevo: 8 caracteres válidos y distintos', () => {
  const a = nuevoCodigo(), b = nuevoCodigo();
  assert.match(a, CODIGO_VALIDO); assert.match(b, CODIGO_VALIDO); assert.notEqual(a, b);
});

test('normaliza mayúsculas y rechaza formas raras', () => {
  assert.equal(normalizarCodigo(' k7q2m9xa '), 'K7Q2M9XA');
  for (const v of ['', null, 'ABC', 'K7Q2M9XA1', 'K7Q2M9X0', '<script>', 'ACADEMY']) assert.equal(normalizarCodigo(v), null);
});

test('la invitación de la URL se guarda y se borra al terminar', () => {
  borrarInvitacion();
  assert.equal(leerInvitacion('?invita=k7q2m9xa'), 'K7Q2M9XA');
  assert.equal(leerInvitacion(''), 'K7Q2M9XA'); // sigue después de recargar (login/Google)
  assert.equal(leerInvitacion('?invita=malo'), 'K7Q2M9XA'); // una inválida no pisa la buena
  borrarInvitacion();
  assert.equal(leerInvitacion(''), null);
});

test('solo se vincula una vez y nunca consigo mismo', () => {
  assert.deepEqual(datosInvitado('K7Q2M9XA', null), { invitado_por: 'K7Q2M9XA' });
  assert.deepEqual(datosInvitado('K7Q2M9XA', { invitado_por: 'ZZZZZZZZ' }), {});
  assert.deepEqual(datosInvitado('K7Q2M9XA', { codigo_invitacion: 'K7Q2M9XA' }), {});
  assert.deepEqual(datosInvitado(null, {}), {});
});

test('enlace de invitación', () => {
  assert.equal(enlaceInvitacion('K7Q2M9XA', 'https://app.trucky.test'), 'https://app.trucky.test/?invita=K7Q2M9XA');
});
