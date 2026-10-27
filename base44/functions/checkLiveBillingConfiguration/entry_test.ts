import handler from './entry.ts';
const url='https://example.test';
const secret='local-preflight-test-only';
Deno.test('rejects missing server authentication without accessing Stripe',async()=>{
 Deno.env.set('TRUCKY_SERVER_SECRET',secret);
 const r=await handler(new Request(url,{method:'POST',body:'{}'}),{});
 if(r.status!==401)throw Error('authentication bypass');
});
Deno.test('test key cannot pass live preflight',async()=>{
 Deno.env.set('TRUCKY_SERVER_SECRET',secret);
 Deno.env.set('STRIPE_LIVE_SECRET_KEY','sk_test_fixture');
 const r=await handler(new Request(url,{method:'POST',headers:{Authorization:`Bearer ${secret}`},body:'{}'}),{});
 if(r.status!==503||(await r.json()).code!=='LIVE_KEY_REQUIRED')throw Error('mode bypass');
});
Deno.test('restricted test key cannot pass live preflight',async()=>{
 Deno.env.set('TRUCKY_SERVER_SECRET',secret);
 Deno.env.set('STRIPE_LIVE_SECRET_KEY','rk_test_fixture');
 const r=await handler(new Request(url,{method:'POST',headers:{Authorization:`Bearer ${secret}`},body:'{}'}),{});
 if(r.status!==503||(await r.json()).code!=='LIVE_KEY_REQUIRED')throw Error('mode bypass');
});
Deno.test('restricted live key passes key prefix validation',async()=>{
 Deno.env.set('TRUCKY_SERVER_SECRET',secret);
 Deno.env.set('STRIPE_LIVE_SECRET_KEY','rk_live_restricted_key_fixture');
 const r=await handler(new Request(url,{method:'POST',headers:{Authorization:`Bearer ${secret}`},body:JSON.stringify({prices:[]})}),{});
 if(r.status!==400||(await r.json()).code!=='PRICES_REQUIRED')throw Error('rk_live key validation failed');
});
Deno.test('invalid price list rejected before contacting Stripe (sk_live)',async()=>{
 Deno.env.set('TRUCKY_SERVER_SECRET',secret);
 Deno.env.set('STRIPE_LIVE_SECRET_KEY','sk_live_local_fixture');
 const r=await handler(new Request(url,{method:'POST',headers:{Authorization:`Bearer ${secret}`},body:JSON.stringify({prices:[]})}),{});
 if(r.status!==400||(await r.json()).code!=='PRICES_REQUIRED')throw Error('input bypass');
});

