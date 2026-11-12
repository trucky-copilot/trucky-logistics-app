import { assertEquals } from 'jsr:@std/assert@1';
import { mergeTemplates, templateUsageNote } from '../base44/shared/emailTemplates.ts';
import defaults from '../base44/functions/marketChat/plantillas_correo.json' with { type: 'json' };

const D = defaults.templates;

Deno.test('plantillas: sin propias se usan las 8 predeterminadas', () => {
  const m = mergeTemplates(D, []);
  assertEquals(m.length, 8);
  assertEquals(m.every((t) => !t.propia), true);
});

Deno.test('plantillas: solo se reemplaza el escenario que el usuario subió; la más reciente gana', () => {
  const m = mergeTemplates(D, [
    { escenario: 'negociar', cuerpo: 'Viejo', updated_date: '2026-11-01T00:00:00Z' },
    { escenario: 'negociar', cuerpo: '  Hi [Broker name], my counter is $[rate].  ', asunto: 'Counter', updated_date: '2026-11-10T00:00:00Z' },
    { escenario: 'inventado', cuerpo: 'x' },
    { escenario: 'aceptar', cuerpo: '   ' },
  ]);
  const neg = m.find((t) => t.id === 'negociar')!;
  assertEquals(neg.propia, true);
  assertEquals(neg.body, 'Hi [Broker name], my counter is $[rate].');
  assertEquals(neg.subject, 'Counter');
  assertEquals(m.filter((t) => t.propia).length, 1);
  assertEquals(m.find((t) => t.id === 'aceptar')!.propia, false);
});

Deno.test('plantillas: el chat indica cuál usó', () => {
  const m = mergeTemplates(D, [{ escenario: 'negociar', cuerpo: 'Hi' }]);
  assertEquals(templateUsageNote(m, 'negociar', 'es'), '_Plantilla usada: NEGOCIAR - Contraoferta · tuya_');
  assertEquals(templateUsageNote(m, 'cotizar_tarifa', 'en').endsWith('· default_'), true);
  assertEquals(templateUsageNote(m, 'nada', 'es'), '');
});
