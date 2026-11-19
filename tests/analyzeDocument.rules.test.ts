import { assertEquals } from 'jsr:@std/assert@1';
import { limpiarPlaceholders, fechaConHora, ventanaHoras, esEmpresaPropia } from '../base44/functions/analyzeDocument/rules.ts';

Deno.test('F2: 08:00 → 15:00 del mismo día son 7 h, no 0 h', () => {
  assertEquals(ventanaHoras({ pickup_fecha: '11/25/2026', pickup_hora: '08:00', delivery_fecha: '11/25/2026', delivery_hora: '15:00' }), 7);
  assertEquals(ventanaHoras({ pickup_fecha: '2026-11-27', pickup_hora: '6:00 AM', delivery_fecha: '2026-11-27', delivery_hora: '4:00 PM' }), 10);
  assertEquals(ventanaHoras({ pickup_fecha: '11/30/2026 07:30', delivery_fecha: '11/30/2026 14:00' }), 6.5);
  assertEquals(ventanaHoras({ pickup_fecha: '11/25/2026', pickup_hora: '0800', delivery_fecha: '11/25/2026', delivery_hora: '1500 hrs' }), 7);
});

Deno.test('F2: sin horas no se calcula la ventana (antes daba 0 h)', () => {
  assertEquals(ventanaHoras({ pickup_fecha: '11/25/2026', delivery_fecha: '11/25/2026' }), null);
  assertEquals(fechaConHora('11/25/2026'), null); // "2026" no es una hora
});

Deno.test('F1: el carrier del documento con el nombre de la empresa es la empresa propia', () => {
  assertEquals(esEmpresaPropia('GrauLogistics', ['GrauLogistics']), true);
  assertEquals(esEmpresaPropia('Grau Logistics LLC', ['GrauLogistics']), true);
  assertEquals(esEmpresaPropia('Other Carrier Inc', ['GrauLogistics', null]), false);
  assertEquals(esEmpresaPropia('AB', ['ABC Trucking']), false);
});

Deno.test('Placeholders de la IA cuentan como vacíos', () => {
  assertEquals(limpiarPlaceholders({ a: 'Not specified', b: 'N/A', c: 'Net 30', d: 0, e: '' }), { a: null, b: null, c: 'Net 30', d: 0, e: null });
});
