// ─────────────────────────────────────────────────────────────────────────────
// Pruebas del schema de extracción del Chat de Mercado (reglas-v3-multiestado,
// Fase 0 — modelo y frontera).
//
// EXTRACTION_SCHEMA vive en rateEngine.ts (no en entry.ts) precisamente para
// poder cubrirlo con `deno test`: entry.ts llama a Deno.serve() en el nivel
// superior y no se puede importar desde una prueba sin levantar el servidor.
//
// Qué cubre: que el schema separe "equipo" de "tamaño" (Decisión 12-C necesita
// el tamaño como dato propio, no mezclado en el enum de equipo), que agregue
// "pago_camion" (Decisión 9-B) y "accessorial_triggers" (gatillos de
// accesoriales, Fase 5 los consume; acá solo se verifica que el dato se pueda
// capturar).
// ─────────────────────────────────────────────────────────────────────────────

import { assertEquals, assert } from 'jsr:@std/assert@1';
import { EXTRACTION_SCHEMA } from '../base44/functions/marketChat/rateEngine.ts';

Deno.test('schema: equipo y tamaño son campos separados, no un solo enum', () => {
  const props = EXTRACTION_SCHEMA.properties;
  assert('equipo' in props, 'falta la propiedad "equipo"');
  assert('tamano' in props, 'falta la propiedad "tamano"');

  // "equipo" ya no debe mezclar tamaños de drayage (drayage_20/drayage_40) en
  // su propio enum — el tamaño es un campo aparte.
  const equipoEnum = (props.equipo as { enum?: string[] }).enum || [];
  assert(!equipoEnum.includes('drayage_20'), 'equipo no debe incluir drayage_20 (eso ahora es tamano)');
  assert(!equipoEnum.includes('drayage_40'), 'equipo no debe incluir drayage_40 (eso ahora es tamano)');
  assert(equipoEnum.includes('drayage'), 'equipo debe seguir aceptando "drayage" sin tamaño');
});

Deno.test('schema: tamano incluye los 4 tamaños de contenedor de la Decisión 12-C', () => {
  const tamanoEnum = (EXTRACTION_SCHEMA.properties.tamano as { enum?: string[] }).enum || [];
  for (const t of ['20', '40', '45', '20_heavy']) {
    assert(tamanoEnum.includes(t), `tamano debe incluir "${t}"`);
  }
});

Deno.test('schema: agrega pago_camion (Decisión 9-B)', () => {
  const props = EXTRACTION_SCHEMA.properties;
  assert('pago_camion' in props, 'falta la propiedad "pago_camion"');
  assertEquals((props.pago_camion as { type?: string }).type, 'number');
});

Deno.test('schema: agrega accessorial_triggers como arreglo de strings', () => {
  const props = EXTRACTION_SCHEMA.properties;
  assert('accessorial_triggers' in props, 'falta la propiedad "accessorial_triggers"');
  const field = props.accessorial_triggers as { type?: string; items?: { type?: string } };
  assertEquals(field.type, 'array');
  assertEquals(field.items?.type, 'string');
});

Deno.test('schema: los campos previos (intent, origen, destino, millas_ida) siguen presentes', () => {
  const props = EXTRACTION_SCHEMA.properties;
  for (const key of ['intent', 'origen', 'destino', 'millas_ida', 'es_redondo', 'tarifa_ofrecida', 'respuesta_general']) {
    assert(key in props, `no debe perderse la propiedad "${key}"`);
  }
});
