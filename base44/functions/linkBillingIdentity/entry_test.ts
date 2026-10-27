import handler from './entry.ts';
Deno.test('disabled identity link never invokes backend',async()=>{
 Deno.env.delete('BILLING_IDENTITY_LINK_ENABLED');
 const r=await handler(new Request('https://example.test',{method:'POST',body:'{}'}),{});
 if(r.status!==503||(await r.json()).code!=='LINK_NOT_ENABLED')throw Error('gate failed');
});
