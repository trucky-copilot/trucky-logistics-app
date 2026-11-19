import test from 'node:test';
import assert from 'node:assert/strict';
import { splitQuoted } from '../src/lib/emailThread.js';

test('respuesta de Gmail: se ve lo nuevo y el texto citado queda aparte', () => {
  const body = 'Received, we will confirm the driver today.\n\nEl jue, 19 nov 2026 a las 15:07, luis bermudez (<luis@x.com>)\nescribió:\n\n> Hi,\n>\n> Please find attached the rate confirmation.';
  const r = splitQuoted(body);
  assert.equal(r.nuevo, 'Received, we will confirm the driver today.');
  assert.match(r.citado, /^El jue, 19 nov 2026/);
  assert.match(r.citado, /> Please find attached/);
});

test('en inglés ("On … wrote:") también se separa', () => {
  const r = splitQuoted('Confirmed. Pickup 08:00.\n\nOn Thu, Nov 19, 2026 at 3:08 PM Luis <luis@x.com> wrote:\n> Received');
  assert.equal(r.nuevo, 'Confirmed. Pickup 08:00.');
  assert.match(r.citado, /^On Thu/);
});

test('un correo sin respuestas citadas queda completo', () => {
  const r = splitQuoted('Hi,\n\nPlease find attached the rate confirmation.\nThanks');
  assert.equal(r.citado, '');
  assert.match(r.nuevo, /Thanks$/);
});

test('si todo es texto citado, no se esconde nada', () => {
  const r = splitQuoted('> solo cita');
  assert.equal(r.nuevo, '> solo cita');
  assert.equal(r.citado, '');
});
