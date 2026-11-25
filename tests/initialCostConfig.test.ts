// QA 25-nov: el registro inicial (usuario Demo) deja la calculadora configurada.
import { assertEquals } from 'jsr:@std/assert@1';
import { completarCostosIniciales } from '../base44/shared/initialCostConfig.ts';

Deno.test('registro inicial con diésel, MPG y % conductor cuenta como configurado', () => {
  const r = completarCostosIniciales({ id: 'c1', diesel_precio: 5.4, mpg: 6.5, pago_conductor_porcentaje: 25 });
  // 5.40/6.5 + (800+1200+300)/2500 = 0.8308 + 0.92 = 1.75
  assertEquals(r!.costo_por_milla, 1.75);
  assertEquals(r!.tarifa_break_even, 2.33);
  assertEquals(r!.id, 'c1');
});

Deno.test('si el usuario guardó la Calculadora, se respetan sus valores', () => {
  const rec = { diesel_precio: 5.4, mpg: 6.5, pago_conductor_porcentaje: 25, costo_por_milla: 2.1, tarifa_break_even: 2.8 };
  assertEquals(completarCostosIniciales(rec), rec);
});

Deno.test('registro incompleto o inválido sigue sin configurar', () => {
  assertEquals(completarCostosIniciales({ diesel_precio: 5.4 })!.costo_por_milla, undefined);
  assertEquals(completarCostosIniciales({ diesel_precio: 5.4, mpg: 0, pago_conductor_porcentaje: 25 })!.costo_por_milla, undefined);
  assertEquals(completarCostosIniciales({ diesel_precio: 5.4, mpg: 6.5, pago_conductor_porcentaje: 100 })!.costo_por_milla, undefined);
  assertEquals(completarCostosIniciales(null), null);
});
