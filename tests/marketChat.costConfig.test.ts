// ─────────────────────────────────────────────────────────────────────────────
// Prueba de la entidad CostConfig (reglas-v3-multiestado, Fase 0).
//
// Decisión 9-B de Juan: "lo que le paga al camión" es un valor estable por
// usuario, no por carga — se guarda en el perfil igual que los costos de la
// Calculadora. Design decision 1: se extiende CostConfig en vez de crear una
// entidad nueva.
// ─────────────────────────────────────────────────────────────────────────────

import { assertEquals, assert } from 'jsr:@std/assert@1';

Deno.test('CostConfig: define pago_camion_rpm como número', async () => {
  const raw = await Deno.readTextFile(
    new URL('../base44/entities/CostConfig.jsonc', import.meta.url),
  );
  const schema = JSON.parse(raw);
  assert('pago_camion_rpm' in schema.properties, 'falta la propiedad "pago_camion_rpm" en CostConfig');
  assertEquals(schema.properties.pago_camion_rpm.type, 'number');
});

Deno.test('CostConfig: pago_camion_rpm no es un campo requerido (puede no estar declarado aún)', async () => {
  const raw = await Deno.readTextFile(
    new URL('../base44/entities/CostConfig.jsonc', import.meta.url),
  );
  const schema = JSON.parse(raw);
  const required: string[] = schema.required || [];
  assert(!required.includes('pago_camion_rpm'), 'pago_camion_rpm no debe ser requerido — puede faltar hasta que el chat lo pregunte');
});
