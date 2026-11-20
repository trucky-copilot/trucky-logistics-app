import { assertEquals, assertMatch } from 'jsr:@std/assert@1';
import { validarSolicitud, mensajeSoporte } from '../base44/functions/requestAccountDeletion/deletionRequest.ts';

Deno.test('F3-15 · eliminar cuenta: exige escribir ELIMINAR o DELETE', () => {
  assertEquals(validarSolicitud({}), { ok: false, code: 'CONFIRMATION_REQUIRED' });
  assertEquals(validarSolicitud({ confirmacion: 'borrar' }), { ok: false, code: 'CONFIRMATION_REQUIRED' });
  assertEquals(validarSolicitud({ confirmacion: ' eliminar ' }), { ok: true, motivo: '' });
  assertEquals(validarSolicitud({ confirmacion: 'DELETE', motivo: ' Ya no <b>lo</b> uso ' }), { ok: true, motivo: 'Ya no lo uso' });
});

Deno.test('F3-15 · eliminar cuenta: el motivo se limita a 500 caracteres', () => {
  const r = validarSolicitud({ confirmacion: 'ELIMINAR', motivo: 'x'.repeat(900) });
  assertEquals(r.ok && r.motivo.length, 500);
});

Deno.test('F3-15 · eliminar cuenta: el correo a soporte trae usuario, empresa y motivo', () => {
  const m = mensajeSoporte({ usuario: 'a@b.com', organizacion: 'Truck USA', organizationId: 'org1', rol: 'owner', motivo: 'cierre', fecha: '2026-11-20T10:00:00Z' });
  assertEquals(m.subject, 'Solicitud de eliminación de cuenta · a@b.com');
  assertMatch(m.body, /Empresa: Truck USA \(org1\)/);
  assertMatch(m.body, /Motivo: cierre/);
});
