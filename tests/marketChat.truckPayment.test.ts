// ─────────────────────────────────────────────────────────────────────────────
// Pruebas de resolveTruckPayment (reglas-v3-multiestado, Fase 0 — Decisión 9-B).
//
// "Lo que le paga al camión" NO es dato de tabla (§2 del kickoff): es un valor
// que declara el usuario, se pregunta UNA sola vez y se reutiliza desde su
// perfil (CostConfig.pago_camion_rpm) — igual que los costos de la Calculadora.
//
// resolveTruckPayment es una función pura: decide si hace falta preguntar y
// qué valor usar. El I/O real (leer/guardar CostConfig) vive en entry.ts y no
// se puede cubrir con `deno test` sin levantar el servidor (mismo límite que
// el resto del módulo I/O) — se verifica por lectura de código + la suite
// completa en verde.
// ─────────────────────────────────────────────────────────────────────────────

import { assertEquals } from 'jsr:@std/assert@1';
import { resolveTruckPayment } from '../base44/functions/marketChat/rateEngine.ts';

Deno.test('truckPayment: primera vez sin perfil y sin dato declarado — hace falta preguntar', () => {
  const decision = resolveTruckPayment(null, null);
  assertEquals(decision.needsAsk, true);
  assertEquals(decision.rpm, null);
  assertEquals(decision.shouldPersist, false);
});

Deno.test('truckPayment: primera vez, el usuario lo declara en el mensaje — se usa y se marca para persistir', () => {
  const decision = resolveTruckPayment(null, 2.75);
  assertEquals(decision.needsAsk, false);
  assertEquals(decision.rpm, 2.75);
  assertEquals(decision.shouldPersist, true, 'debe guardarse en el perfil la primera vez que se declara');
});

Deno.test('truckPayment: ya guardado en el perfil — se reutiliza sin volver a preguntar ni volver a guardar', () => {
  const decision = resolveTruckPayment({ pago_camion_rpm: 3.10 }, null);
  assertEquals(decision.needsAsk, false);
  assertEquals(decision.rpm, 3.10);
  assertEquals(decision.shouldPersist, false, 'no debe reescribirse un valor que ya estaba guardado');
});

Deno.test('truckPayment: guardado en el perfil Y declarado de nuevo en el mensaje — gana el perfil, no se pregunta ni se sobreescribe en silencio', () => {
  const decision = resolveTruckPayment({ pago_camion_rpm: 3.10 }, 5.00);
  assertEquals(decision.needsAsk, false);
  assertEquals(decision.rpm, 3.10);
  assertEquals(decision.shouldPersist, false);
});

Deno.test('truckPayment: valores inválidos guardados (null, 0, negativo, NaN) se tratan como "no guardado"', () => {
  for (const invalido of [null, 0, -1, NaN, undefined]) {
    const decision = resolveTruckPayment({ pago_camion_rpm: invalido as unknown as number }, null);
    assertEquals(decision.needsAsk, true, `pago_camion_rpm=${invalido} debe pedirse de nuevo`);
  }
});

Deno.test('truckPayment: valor declarado inválido (0, negativo, no numérico) no cuenta como declaración', () => {
  for (const invalido of [0, -5, NaN, undefined]) {
    const decision = resolveTruckPayment(null, invalido as unknown as number);
    assertEquals(decision.needsAsk, true, `declarar ${invalido} no debe evitar la pregunta`);
  }
});
