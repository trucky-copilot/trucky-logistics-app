import {deepStrictEqual as eq} from 'node:assert/strict';
Deno.test('native onboarding entry registers Deno.serve when imported as a module',async()=>{
 const original=Deno.serve;let registered:any;
 try{
  // Observe registration, do not listen on a network socket.
  Deno.serve=((handler:any)=>{registered=handler;return {} as Deno.HttpServer;}) as typeof Deno.serve;
  await import('../../base44/functions/ensureUserOrganization/entry.ts?registration-test');
  eq(typeof registered,'function');
  const response=await registered(new Request('https://example.invalid',{method:'GET'}));
  eq(response.status,405);
 }finally{Deno.serve=original;}
});
Deno.test('native link notice uses the canonical web domain, no ticket/token in its link',async()=>{
 const source=await Deno.readTextFile(new URL('../../src/pages/Onboarding.jsx',import.meta.url));
 eq(source.includes('href="https://www.trucky-ai.com/billing-link"'),true);
});
