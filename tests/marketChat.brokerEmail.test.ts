import { assertEquals } from 'jsr:@std/assert@1';
import { pickBrokerEmail } from '../base44/functions/marketChat/brokerEmail.ts';

Deno.test('destinatario: primero el email del broker en la tabla', () => {
  assertEquals(pickBrokerEmail({ nombre: 'Ross Reed', email: 'ross@x.com' }, 'Ross', []), 'ross@x.com');
});
Deno.test('destinatario: si no, el último correo de ese remitente en la bandeja', () => {
  const inbox = [
    { remitente_nombre: 'Ross Reed', remitente_email: 'old@teamway.com', fecha: '2026-11-01T00:00:00Z' },
    { remitente_nombre: 'Ross Reed', remitente_email: 'r.reed@teamwaytrucking.com', fecha: '2026-11-12T00:00:00Z' },
    { remitente_nombre: 'Otro', remitente_email: 'x@y.com', fecha: '2026-11-13T00:00:00Z' },
  ];
  assertEquals(pickBrokerEmail(null, 'Ross Reed', inbox), 'r.reed@teamwaytrucking.com');
  assertEquals(pickBrokerEmail(null, 'Nadie', inbox), '');
});
