// Ticket 91: demos 15 días; solo con código de dispatcher, 1 mes (30 días).
import { assertEquals } from 'jsr:@std/assert@1';
import { resolveTrial } from '../../base44/functions/activateDemoTrial/trialPolicy.ts';

const env = (vars: Record<string, string>) => (n: string) => vars[n];

Deno.test('demo sin código → 15 días', () => {
  assertEquals(resolveTrial(undefined, env({})), { ok: true, days: 15, kind: 'demo' });
  assertEquals(resolveTrial('  ', env({})), { ok: true, days: 15, kind: 'demo' });
});
Deno.test('código de dispatcher válido → 30 días (sin importar mayúsculas/espacios)', () => {
  const e = env({ DEMO_DISPATCHER_CODES: 'DISP2026, OTRO' });
  assertEquals(resolveTrial('disp2026 ', e), { ok: true, days: 30, kind: 'dispatcher' });
  assertEquals(resolveTrial('OTRO', e), { ok: true, days: 30, kind: 'dispatcher' });
});
Deno.test('código inválido o sin códigos configurados → error, no activa nada', () => {
  assertEquals(resolveTrial('NOPE', env({ DEMO_DISPATCHER_CODES: 'DISP2026' })), { ok: false, code: 'INVALID_DISPATCHER_CODE' });
  assertEquals(resolveTrial('DISP2026', env({})), { ok: false, code: 'INVALID_DISPATCHER_CODE' });
  assertEquals(resolveTrial(123, env({ DEMO_DISPATCHER_CODES: '123' })), { ok: false, code: 'INVALID_DISPATCHER_CODE' });
});
Deno.test('los días se cambian por secreto sin reprogramar (y valores raros se ignoran)', () => {
  assertEquals(resolveTrial(undefined, env({ DEMO_TRIAL_DAYS: '7' })).ok && resolveTrial(undefined, env({ DEMO_TRIAL_DAYS: '7' })), { ok: true, days: 7, kind: 'demo' });
  assertEquals(resolveTrial(undefined, env({ DEMO_TRIAL_DAYS: 'abc' })), { ok: true, days: 15, kind: 'demo' });
  assertEquals(resolveTrial('X', env({ DEMO_DISPATCHER_CODES: 'X', DEMO_DISPATCHER_TRIAL_DAYS: '45' })), { ok: true, days: 45, kind: 'dispatcher' });
});
