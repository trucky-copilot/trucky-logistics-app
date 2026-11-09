import {deepStrictEqual as assertEquals} from 'node:assert/strict';
import handler from '../../base44/functions/resolveUserOrganizations/entry.ts';
Deno.test('resolver HTTP rejects invalid body/mode and live disabled before Google or Base44',async()=>{
 const names=['TRUCKY_SERVER_SECRET','BILLING_LIVE_CHECKOUT_ELIGIBILITY_ENABLED'];
 const saved=names.map(k=>Deno.env.get(k));const original=globalThis.fetch;
 try{
  Deno.env.set('TRUCKY_SERVER_SECRET','local-entry-fixture');Deno.env.set('BILLING_LIVE_CHECKOUT_ELIGIBILITY_ENABLED','false');
  globalThis.fetch=()=>{throw Error('unexpected external request');};
  const cases:Array<[string,number,string]>=[['null',400,'INVALID_REQUEST'],['[]',400,'INVALID_REQUEST'],['{"mode":"unknown"}',400,'INVALID_MODE'],['{"mode":"live"}',503,'LIVE_CHECKOUT_NOT_READY']];
  for(const [body,status,code] of cases){
   const r=await handler(new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer local-entry-fixture'},body}),{});
   assertEquals(r.status,status);assertEquals((await r.json()).error,code);
  }
 }finally{globalThis.fetch=original;names.forEach((k,i)=>{if(saved[i]===undefined)Deno.env.delete(k);else Deno.env.set(k,saved[i]!);});}
});
