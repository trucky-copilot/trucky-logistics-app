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

Deno.test('precio inexistente en la cuenta de la llave → LIVE_PRICE_NOT_FOUND',async()=>{
 Deno.env.set('TRUCKY_SERVER_SECRET',secret);
 Deno.env.set('STRIPE_LIVE_SECRET_KEY','sk_live_local_fixture');
 const original=globalThis.fetch;
 globalThis.fetch=(async()=>new Response('{"error":{}}',{status:404})) as typeof fetch;
 try{
  const r=await handler(new Request(url,{method:'POST',headers:{Authorization:`Bearer ${secret}`},body:JSON.stringify({prices:['price_A','price_B']})}),{});
  const b=await r.json();
  if(r.status!==400||b.code!=='LIVE_PRICE_NOT_FOUND')throw Error('expected LIVE_PRICE_NOT_FOUND, got '+b.code);
 }finally{globalThis.fetch=original;}
});
Deno.test('precios reales mensuales → LIVE_CONFIGURATION_VALID',async()=>{
 Deno.env.set('TRUCKY_SERVER_SECRET',secret);
 Deno.env.set('STRIPE_LIVE_SECRET_KEY','rk_live_local_fixture');
 const original=globalThis.fetch;
 globalThis.fetch=(async()=>Response.json({livemode:true,active:true,currency:'usd',unit_amount:2900,type:'recurring',recurring:{interval:'month',interval_count:1},billing_scheme:'per_unit'})) as typeof fetch;
 try{
  const r=await handler(new Request(url,{method:'POST',headers:{Authorization:`Bearer ${secret}`},body:JSON.stringify({prices:['price_A','price_B']})}),{});
  const b=await r.json();
  if(r.status!==200||b.code!=='LIVE_CONFIGURATION_VALID')throw Error('expected valid, got '+b.code);
 }finally{globalThis.fetch=original;}
});
