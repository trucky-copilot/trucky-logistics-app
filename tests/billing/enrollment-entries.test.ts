import {deepStrictEqual as eq} from 'node:assert/strict';
import create from '../../base44/functions/createOrganizationForUser/entry.ts';
import {ensureUserOrganization as ensure} from '../../base44/functions/ensureUserOrganization/handler.ts';
async function withEnv(run:()=>Promise<void>){
 const names=['TRUCKY_SERVER_SECRET','BILLING_PUBLIC_ENROLLMENT_ENABLED','PUBLIC_TEST_DEMO_ENABLED'];const old=names.map(k=>Deno.env.get(k));
 try{Deno.env.set('PUBLIC_TEST_DEMO_ENABLED','false');await run();}finally{names.forEach((k,i)=>{if(old[i]===undefined)Deno.env.delete(k);else Deno.env.set(k,old[i]!);});}
}
function req(){return new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer local-only-fixture'},body:JSON.stringify({google_id_token:'x'.repeat(30),company_name:'Company'})});}
Deno.test('create actual handler: existing candidate 409, no writes or creation lock',async()=>withEnv(async()=>{
 Deno.env.set('TRUCKY_SERVER_SECRET','local-only-fixture');Deno.env.set('BILLING_PUBLIC_ENROLLMENT_ENABLED','true');let writes=0,redis=0;
 const db={OrganizationMember:{filter:async(q:any)=>q.google_sub?[]:[{id:'existing'}]},Organization:{filter:async()=>[]},};
 const r=await create(req(),{}, {verify:async()=>({sub:'google',email:'fixture@example.invalid'}),db,redis:async()=>{redis++;return null;}});
 eq(r.status,409);eq((await r.json()).error,'EXISTING_ORGANIZATION_REQUIRES_VERIFIED_LINK');eq(redis,0);eq(writes,0);
}));
Deno.test('create actual handler: quota before lock, uncertain create retains owned lock',async()=>withEnv(async()=>{
 Deno.env.set('TRUCKY_SERVER_SECRET','local-only-fixture');Deno.env.set('BILLING_PUBLIC_ENROLLMENT_ENABLED','true');let sets=0,creates=0;const commands:any[]=[];
 const db={OrganizationMember:{filter:async()=>[]},Organization:{filter:async()=>[],create:async()=>{creates++;throw Error('provider timeout');}}};
 let quota=0;const redis=async(c:any[])=>{commands.push(c);if(c[0]==='EVAL')return quota;if(c[0]==='SET'){sets++;return 'OK';}return null;};
 const deps={verify:async()=>({sub:'google',email:'fixture@example.invalid'}),db,redis};
 const a=await create(req(),{},deps);eq(a.status,429);eq(sets,0);eq(creates,0);
 quota=1;const b=await create(req(),{},deps);eq(b.status,500);eq(sets,1);eq(creates,1);eq(commands.some(c=>c[0]==='EVAL'&&String(c[1]).includes("redis.call('DEL'")),false);
}));
Deno.test('ensure actual handler: registered but unlinked company returns 409 without creating membership',async()=>{
 let writes=0;const db={Organization:{filter:async()=>[{id:'org',active:true}]},OrganizationMember:{filter:async()=>[{id:'member',google_sub:'google',active:true}],create:async()=>{writes++;}}};
 const r=await ensure(req(),{user:{id:'native',email:'fixture@example.invalid'},db,redis:async()=>JSON.stringify({version:1,orgId:'org',memberId:'member',googleSub:'google',role:'owner'})});
 eq(r.status,409);eq((await r.json()).error,'BILLING_IDENTITY_LINK_REQUIRED');eq(writes,0);
});
