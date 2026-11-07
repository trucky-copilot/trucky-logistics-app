/**
 * Puerta de syncBillingSubscription SIN dependencias npm (probable en tests/):
 * autenticación servidor-a-servidor primero, luego el modo y su indicador.
 * Nada pasa de aquí sin el secreto correcto; con el indicador apagado no se
 * crea cliente, no se lee Stripe, Base44 ni Redis.
 */
export interface GateEnv { secret?: string | null; liveEnabled: boolean; testEnabled: boolean }
export type Gate =
  | { kind: 'response'; status: number; code: string }
  | { kind: 'live'; body: Record<string, unknown> }
  | { kind: 'test'; body: Record<string, unknown> };

const stop = (code: string, status: number): Gate => ({ kind: 'response', code, status });

async function sha256(s: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

export async function gateSyncRequest(req: Request, env: GateEnv): Promise<Gate> {
  if (req.method !== 'POST') return stop('METHOD_NOT_ALLOWED', 405);
  if (!env.secret) return stop('UNAUTHORIZED', 401);
  // Hash both strings before constant-length comparison.
  const a = await sha256(req.headers.get('authorization') || '');
  const b = await sha256(`Bearer ${env.secret}`);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  if (difference !== 0) return stop('UNAUTHORIZED', 401);

  let body: unknown;
  try { body = await req.json(); } catch { return stop('INVALID_REQUEST', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return stop('INVALID_REQUEST', 400);
  const b2 = body as Record<string, unknown>;
  if (b2.mode === 'live') return env.liveEnabled ? { kind: 'live', body: b2 } : stop('SYNC_NOT_ENABLED', 503);
  if (b2.mode !== undefined && b2.mode !== 'test') return stop('INVALID_MODE', 400);
  return env.testEnabled ? { kind: 'test', body: b2 } : stop('SYNC_NOT_ENABLED', 503);
}
