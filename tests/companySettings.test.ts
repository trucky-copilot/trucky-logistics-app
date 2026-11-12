import { assertEquals } from 'jsr:@std/assert@1';
import { planCompanyChange } from '../base44/shared/companySettings.ts';

const org = { name: 'Acme Trucking', historial_nombre: [] };
const now = new Date('2026-11-12T15:00:00Z');

Deno.test('empresa: cambiar el nombre sin confirmar se rechaza (409)', () => {
  const r = planCompanyChange(org, { nombre: 'Acme Logistics' }, 'a@x.com', now);
  assertEquals(r.ok, false);
  if (!r.ok) { assertEquals(r.status, 409); assertEquals(r.requiere_confirmacion, true); }
});

Deno.test('empresa: con confirmación cambia el nombre, lo registra con fecha y lo copia al carrier', () => {
  const r = planCompanyChange(org, { nombre: '  Acme   Logistics ', confirmar_nombre: true }, 'a@x.com', now);
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.orgPatch.name, 'Acme Logistics');
    assertEquals(r.carrierPatch, { company_name: 'Acme Logistics' });
    assertEquals(r.orgPatch.historial_nombre, [{ anterior: 'Acme Trucking', nuevo: 'Acme Logistics', fecha: '2026-11-12T15:00:00.000Z', usuario: 'a@x.com' }]);
  }
});

Deno.test('empresa: el mismo nombre no pide confirmación ni deja registro', () => {
  const r = planCompanyChange(org, { nombre: 'Acme Trucking', tipos_camion: ['reefer'] }, 'a@x.com', now);
  assertEquals(r.ok, true);
  if (r.ok) { assertEquals(r.orgPatch, { tipos_camion: ['reefer'] }); assertEquals(r.cambioNombre, null); }
});

Deno.test('empresa: un solo tipo de camión; más de uno o desconocidos se rechazan', () => {
  const r = planCompanyChange(org, { tipos_camion: ['drayage', 'drayage'] }, 'a@x.com', now);
  if (r.ok) assertEquals(r.orgPatch.tipos_camion, ['drayage']); else throw new Error('debía aceptar');
  assertEquals(planCompanyChange(org, { tipos_camion: ['drayage', 'dry_van'] }, 'a@x.com', now).ok, false);
  const vacio = planCompanyChange(org, { tipos_camion: [] }, 'a@x.com', now);
  if (vacio.ok) assertEquals(vacio.orgPatch.tipos_camion, []); else throw new Error('vacío debía aceptarse');
  const m = planCompanyChange(org, { tipos_camion: ['tanker'] }, 'a@x.com', now);
  assertEquals(m.ok, false);
});

Deno.test('empresa: nombre vacío o demasiado largo se rechaza', () => {
  assertEquals(planCompanyChange(org, { nombre: ' ', confirmar_nombre: true }, 'a', now).ok, false);
  assertEquals(planCompanyChange(org, { nombre: 'x'.repeat(121), confirmar_nombre: true }, 'a', now).ok, false);
});
