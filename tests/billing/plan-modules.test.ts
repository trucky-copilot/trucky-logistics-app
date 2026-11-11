// Ticket 101: módulos por plan desde la tabla PlanModule (servidor y pantalla).
import { assertEquals } from 'jsr:@std/assert@1';
import { DEFAULT_MATRIX, matrixFromRows, loadPlanMatrix, planAllows, resetPlanMatrixCache } from '../../base44/shared/planModules.ts';

Deno.test('por defecto: el correo es solo del plan Pro (plan_99)', () => {
  assertEquals([DEFAULT_MATRIX.demo.email_module, DEFAULT_MATRIX.plan_29.email_module, DEFAULT_MATRIX.plan_99.email_module], [false, false, true]);
});
Deno.test('la tabla manda sobre el defecto; filas inválidas se ignoran', () => {
  const m = matrixFromRows([
    { plan: 'plan_29', module: 'email_module', enabled: true },
    { plan: 'plan_99', module: 'chat', enabled: false },
    { plan: 'plan_500', module: 'chat', enabled: true },
    { plan: 'demo', module: 'otro', enabled: true },
    { plan: 'demo', module: 'chat', enabled: 'si' },
  ]);
  assertEquals(m.plan_29.email_module, true);
  assertEquals(m.plan_99.chat, false);
  assertEquals(m.demo.chat, true);
});
Deno.test('admin siempre puede; plan desconocido nunca', () => {
  assertEquals(planAllows(DEFAULT_MATRIX, 'admin', 'email_module'), true);
  assertEquals(planAllows(DEFAULT_MATRIX, 'gratis', 'chat'), false);
});
Deno.test('servidor: lee la tabla con caché de 60 s y si falla usa el defecto', async () => {
  resetPlanMatrixCache();
  let reads = 0;
  const db = { PlanModule: { filter: async () => { reads++; return [{ plan: 'plan_29', module: 'email_module', enabled: true }]; } } };
  assertEquals((await loadPlanMatrix(db, 1000)).plan_29.email_module, true);
  await loadPlanMatrix(db, 1000 + 59_000);
  assertEquals(reads, 1);
  resetPlanMatrixCache();
  const roto = { PlanModule: { filter: async () => { throw new Error('caído'); } } };
  assertEquals((await loadPlanMatrix(roto, 5000)).plan_29.email_module, false);
  resetPlanMatrixCache();
});
