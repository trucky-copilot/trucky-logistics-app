// Puerta de syncBillingSubscription: 401 sin autorización y 503 SYNC_NOT_ENABLED
// con autenticación válida e indicador apagado. Sin dependencias npm ni red.
import { assertEquals } from 'jsr:@std/assert@1';
import { gateSyncRequest, type GateEnv } from '../../base44/functions/syncBillingSubscription/gate.ts';

const SECRET = 'fixture-secret-not-real';
const req = (body: unknown, auth?: string, method = 'POST') =>
  new Request('https://example.test/sync', {
    method,
    headers: auth ? { authorization: auth, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
const OFF: GateEnv = { secret: SECRET, liveEnabled: false, testEnabled: false };
const live = { mode: 'live', organization_id: 'org', subscription_id: 'sub_x' };

Deno.test('401: sin encabezado, secreto incorrecto o servidor sin secreto configurado', async () => {
  for (const [r, env] of [
    [req(live), OFF],
    [req(live, 'Bearer otro-secreto'), OFF],
    [req(live, SECRET), OFF], // sin el prefijo Bearer
    [req(live, `Bearer ${SECRET}`), { ...OFF, secret: '' }],
    [req(live, `Bearer ${SECRET}`), { ...OFF, secret: undefined }],
  ] as [Request, GateEnv][]) {
    assertEquals(await gateSyncRequest(r, env), { kind: 'response', code: 'UNAUTHORIZED', status: 401 });
  }
});

Deno.test('401 se decide antes de leer el cuerpo (un cuerpo inválido sin auth sigue siendo 401)', async () => {
  assertEquals(await gateSyncRequest(req('{no-json'), OFF), { kind: 'response', code: 'UNAUTHORIZED', status: 401 });
});

Deno.test('503 SYNC_NOT_ENABLED: autenticación válida e indicador live apagado', async () => {
  const g = await gateSyncRequest(req(live, `Bearer ${SECRET}`), { ...OFF, testEnabled: true });
  assertEquals(g, { kind: 'response', code: 'SYNC_NOT_ENABLED', status: 503 });
});

Deno.test('503 SYNC_NOT_ENABLED: autenticación válida e indicador de pruebas apagado (sin mode y mode:test)', async () => {
  for (const b of [{ organization_id: 'org', subscription_id: 'sub_x' }, { mode: 'test', organization_id: 'org', subscription_id: 'sub_x' }]) {
    const g = await gateSyncRequest(req(b, `Bearer ${SECRET}`), { ...OFF, liveEnabled: true });
    assertEquals(g, { kind: 'response', code: 'SYNC_NOT_ENABLED', status: 503 });
  }
});

Deno.test('indicador live encendido solo deja pasar el modo live; el de pruebas sigue apagado', async () => {
  const env = { ...OFF, liveEnabled: true };
  assertEquals((await gateSyncRequest(req(live, `Bearer ${SECRET}`), env)).kind, 'live');
  assertEquals((await gateSyncRequest(req({ organization_id: 'org' }, `Bearer ${SECRET}`), env)).kind === 'response', true);
});

Deno.test('modo desconocido, cuerpo inválido y método no POST', async () => {
  const env = { ...OFF, liveEnabled: true, testEnabled: true };
  assertEquals(await gateSyncRequest(req({ mode: 'prod' }, `Bearer ${SECRET}`), env), { kind: 'response', code: 'INVALID_MODE', status: 400 });
  assertEquals(await gateSyncRequest(req('[1]', `Bearer ${SECRET}`), env), { kind: 'response', code: 'INVALID_REQUEST', status: 400 });
  assertEquals(await gateSyncRequest(req('{x', `Bearer ${SECRET}`), env), { kind: 'response', code: 'INVALID_REQUEST', status: 400 });
  assertEquals(await gateSyncRequest(req(null, `Bearer ${SECRET}`, 'GET'), env), { kind: 'response', code: 'METHOD_NOT_ALLOWED', status: 405 });
});
