import { assertEquals } from 'jsr:@std/assert@1';
import { TX_SIZE_FACTORS, deriveTxPrice } from '../base44/functions/marketChat/sizeDerivation.ts';

Deno.test('factores TX: 40 es nativo, el resto derivado (12-C)', () => {
  assertEquals(TX_SIZE_FACTORS['40'].derivado, false);
  assertEquals(TX_SIZE_FACTORS['20'].derivado, true);
  assertEquals(TX_SIZE_FACTORS['45'].derivado, true);
  assertEquals(TX_SIZE_FACTORS['20_heavy'].derivado, true);
});

Deno.test('factores TX: doble supuesto solo en 45 y 20_heavy', () => {
  assertEquals(TX_SIZE_FACTORS['20'].dobleSupuesto, false);
  assertEquals(TX_SIZE_FACTORS['40'].dobleSupuesto, false);
  assertEquals(TX_SIZE_FACTORS['45'].dobleSupuesto, true);
  assertEquals(TX_SIZE_FACTORS['20_heavy'].dobleSupuesto, true);
});

Deno.test('factores TX: valores exactos de la Decisión 12-C', () => {
  assertEquals(Math.round(TX_SIZE_FACTORS['20'].factor * 10000) / 10000, 0.9091);
  assertEquals(Math.round(TX_SIZE_FACTORS['45'].factor * 1000) / 1000, 1.018);
  assertEquals(Math.round(TX_SIZE_FACTORS['20_heavy'].factor * 10000) / 10000, 1.0636);
});

Deno.test('deriveTxPrice: Irving 40\'=$567 deriva correctamente los otros 3 tamaños', () => {
  assertEquals(deriveTxPrice(567, '40'), { valor: 567, derivado: false, dobleSupuesto: false });
  assertEquals(deriveTxPrice(567, '20').valor, 515); // 567/1.10 = 515.45
  assertEquals(deriveTxPrice(567, '45').valor, 577); // 567*1.018 = 577.206
  assertEquals(deriveTxPrice(567, '20_heavy').valor, 603); // 567*1.0636... = 603.06
});

Deno.test('deriveTxPrice: aplica igual sobre el piso que sobre el objetivo (misma proporción)', () => {
  const piso = deriveTxPrice(520, '20');
  assertEquals(piso.valor, 473); // 520/1.10 = 472.7
  assertEquals(piso.derivado, true);
});

Deno.test('deriveTxPrice: es determinista', () => {
  const resultados = Array.from({ length: 10 }, () => deriveTxPrice(600, '45'));
  for (const r of resultados) assertEquals(r, resultados[0]);
});
