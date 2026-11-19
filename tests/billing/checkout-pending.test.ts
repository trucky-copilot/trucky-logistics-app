import { assertEquals } from 'jsr:@std/assert@1';
import { markCheckoutPending, isCheckoutPending, clearCheckoutPending, checkoutPendingKey, CHECKOUT_PENDING_TTL_SECONDS } from '../../base44/shared/checkoutPending.ts';

function fakeRedis() {
  const store = new Map<string, string>(); const calls: unknown[][] = [];
  const redis = async (c: unknown[]) => {
    calls.push(c);
    const [op, key, value] = c as string[];
    if (op === 'SET') { store.set(key, value); return 'OK'; }
    if (op === 'GET') return store.get(key) ?? null;
    if (op === 'DEL') { store.delete(key); return 1; }
    throw Error('unexpected');
  };
  return { redis, store, calls };
}

Deno.test('pago en curso: se marca con vencimiento de 2 horas', async () => {
  const r = fakeRedis();
  assertEquals(await markCheckoutPending(r.redis, 'org_1'), true);
  assertEquals(r.calls[0], ['SET', checkoutPendingKey('org_1'), '1', 'EX', String(CHECKOUT_PENDING_TTL_SECONDS)]);
  assertEquals(CHECKOUT_PENDING_TTL_SECONDS, 7200);
});

Deno.test('pago en curso: se detecta entre las empresas del usuario y se limpia al activar', async () => {
  const r = fakeRedis();
  await markCheckoutPending(r.redis, 'org_2');
  assertEquals(await isCheckoutPending(r.redis, ['org_1', 'org_2']), true);
  await clearCheckoutPending(r.redis, 'org_2');
  assertEquals(await isCheckoutPending(r.redis, ['org_1', 'org_2']), false);
});

Deno.test('pago en curso: ignora identificadores inválidos sin tocar Redis', async () => {
  const r = fakeRedis();
  assertEquals(await markCheckoutPending(r.redis, 'org:*'), false);
  assertEquals(await isCheckoutPending(r.redis, [null, 'a b', undefined]), false);
  assertEquals(r.calls.length, 0);
});
