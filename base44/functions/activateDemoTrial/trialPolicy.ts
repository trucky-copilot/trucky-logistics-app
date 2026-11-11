// Ticket 91: período gratis de la demo.
//   - Demo normal: 15 días (secreto DEMO_TRIAL_DAYS para cambiarlo sin reprogramar).
//   - Con código de dispatcher válido: 1 mes = 30 días (DEMO_DISPATCHER_TRIAL_DAYS).
// Los códigos válidos viven en el secreto DEMO_DISPATCHER_CODES (separados por coma),
// nunca en el código. Un código inválido NO activa nada: así el usuario puede
// corregirlo sin quedar amarrado a los 15 días (la demo no se puede reiniciar).
export const DEFAULT_TRIAL_DAYS = 15;
export const DEFAULT_DISPATCHER_TRIAL_DAYS = 30;

type Env = (name: string) => string | undefined;

function days(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : fallback;
}

function sameText(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function resolveTrial(code: unknown, env: Env):
  { ok: true; days: number; kind: 'demo' | 'dispatcher' } | { ok: false; code: 'INVALID_DISPATCHER_CODE' } {
  const base = days(env('DEMO_TRIAL_DAYS'), DEFAULT_TRIAL_DAYS);
  if (code == null || (typeof code === 'string' && code.trim() === '')) return { ok: true, days: base, kind: 'demo' };
  if (typeof code !== 'string' || code.length > 64) return { ok: false, code: 'INVALID_DISPATCHER_CODE' };
  const wanted = code.trim().toUpperCase();
  const valid = (env('DEMO_DISPATCHER_CODES') || '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  let match = false;
  for (const v of valid) match = sameText(v, wanted) || match; // sin cortar antes: tiempo constante
  if (!match) return { ok: false, code: 'INVALID_DISPATCHER_CODE' };
  return { ok: true, days: days(env('DEMO_DISPATCHER_TRIAL_DAYS'), DEFAULT_DISPATCHER_TRIAL_DAYS), kind: 'dispatcher' };
}
