export async function demoRedis(command: unknown[]) {
  const url = Deno.env.get('CHECKOUT_REDIS_REST_URL');
  const token = Deno.env.get('CHECKOUT_REDIS_REST_TOKEN');
  if (!url || !token || new URL(url).protocol !== 'https:') throw Error('DEMO_REGISTRY_CONFIGURATION');
  const response = await fetch(url, { method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command), signal: AbortSignal.timeout(8000) });
  if (!response.ok) { console.error('demo_registry_http_failed', { status: response.status }); throw Error('DEMO_REGISTRY_HTTP'); }
  const data = await response.json();
  if (data.error || !Object.hasOwn(data, 'result')) throw Error('DEMO_REGISTRY_COMMAND');
  return data.result;
}
export async function isDemoOrganization(id: string) {
  if (Deno.env.get('PUBLIC_TEST_DEMO_ENABLED') !== 'true') return false;
  return await demoRedis(['GET', `trucky:demo:test:eligible:${id}`]) === '1';
}
export async function registerDemoOrganization(id: string) {
  await demoRedis(['SET', `trucky:demo:test:eligible:${id}`, '1', 'NX']);
}
