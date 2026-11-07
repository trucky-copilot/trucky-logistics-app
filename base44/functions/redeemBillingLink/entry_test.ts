import handler from './entry.ts';
Deno.test('link disabled does not touch backend or Redis',async()=>{
 Deno.env.delete('BILLING_IDENTITY_LINK_ENABLED');
 const response=await handler(new Request('https://example.test',{method:'POST',body:'{}'}),{});
 if(response.status!==503||(await response.json()).code!=='LINK_NOT_ENABLED')throw Error('gate failed');
});
Deno.test('link redemption requires POST',async()=>{
 const response=await handler(new Request('https://example.test'),{});
 if(response.status!==405)throw Error('method accepted');
});
