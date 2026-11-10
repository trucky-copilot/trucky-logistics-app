import {deepStrictEqual as eq} from 'node:assert/strict';
import {authorizePlanFeature} from '../../base44/shared/entitlements.ts';
import endpoint from '../../base44/functions/getMyPlan/entry.ts';
const user={id:'native',email:'owner@example.invalid'},member={id:'member',organization_id:'org',google_sub:'google',base44_user_id:'native',role:'owner',active:true};
const org={id:'org',active:true,stripe_live_subscription_id:'sub_real',stripe_live_customer_id:'cus_real'};
const price={id:'price_owner',livemode:true,currency:'usd',unit_amount:2900,type:'recurring',recurring:{interval:'month',interval_count:1},billing_scheme:'per_unit'};
async function isolated(run:(db:any,state:{status:string;invoice:string})=>Promise<void>){
 const originalNow=Date.now;let clock=originalNow()+Math.random()*1e9;Date.now=()=>clock;
 const vars={BILLING_LIVE_ENFORCEMENT_ENABLED:'true',CHECKOUT_REDIS_REST_URL:'https://redis.example.invalid',CHECKOUT_REDIS_REST_TOKEN:'local-fixture',STRIPE_LIVE_SECRET_KEY:'rk_live_fixture',STRIPE_LIVE_PRICE_OWNER_OP:'price_owner',STRIPE_LIVE_PRICE_FLEET:'price_fleet'};
 const saved=Object.keys(vars).map(k=>Deno.env.get(k)),original=globalThis.fetch,state={status:'active',invoice:'paid'};
 const db={asServiceRole:{entities:{OrganizationMember:{filter:async()=>[member]},Organization:{filter:async()=>[org]},TestAccount:{filter:async()=>[]},DemoTrial:{filter:async()=>[]}}}};
 try{
  for(const[k,v]of Object.entries(vars))Deno.env.set(k,v);
  globalThis.fetch=(async(input:any,init?:RequestInit)=>{
   const url=String(input);
   if(url==='https://redis.example.invalid'){
    const [op,key]=JSON.parse(String(init?.body));let result:unknown;
    if(op==='EXISTS')result=0;else if(String(key).includes(':native:'))result='google';else if(String(key).includes(':identity:'))result='native';else if(String(key).includes(':member:'))result=JSON.stringify({memberId:'member',orgId:'org',googleSub:'google',role:'owner'});else throw Error('unexpected redis read');
    return Response.json({result});
   }
   if(url.startsWith('https://api.stripe.com/v1/subscriptions/sub_real?')){
    eq(new Headers(init?.headers).get('Authorization'),'Bearer rk_live_fixture');
    eq(new URL(url).searchParams.get('expand[]'),'latest_invoice');
    return Response.json({id:'sub_real',livemode:true,customer:'cus_real',metadata:{org_id:'org'},status:state.status,trial_end:null,items:{data:[{quantity:1,price}]},latest_invoice:{billing_reason:'subscription_create',status:state.invoice,livemode:true,customer:'cus_real',subscription:'sub_real'}});
   }
   if(url.startsWith('https://api.stripe.com/v1/invoices?'))return Response.json({data:state.invoice==='paid'?[{id:'in_real',livemode:true,status:'paid',currency:'usd',amount_paid:2900,customer:'cus_real',subscription:'sub_real',billing_reason:'subscription_create',status_transitions:{paid_at:100},lines:{data:[{quantity:1,amount:2900,price:{id:'price_owner'}}]}}]:[]});
   throw Error('unexpected network');
  }) as typeof fetch;
  await run(db,state);
 }finally{Date.now=originalNow;globalThis.fetch=original;Object.keys(vars).forEach((k,i)=>saved[i]===undefined?Deno.env.delete(k):Deno.env.set(k,saved[i]!));}
}
Deno.test('actual shared server entitlement uses verified live plan, not dispatcher/test upgrade',()=>isolated(async db=>{
 const r=await authorizePlanFeature(db,user,'email_module');eq(r.allowed,true);eq(r.plan,'plan_29');eq(r.organizationId,'org');
}));
Deno.test('actual server rejects canceled subscription or unpaid invoice despite old test fields',()=>isolated(async(db,state)=>{
 state.status='canceled';eq((await authorizePlanFeature(db,user,'chat')).allowed,false);
 state.status='active';state.invoice='open';const oldNow=Date.now();Date.now=()=>oldNow+31000;eq((await authorizePlanFeature(db,user,'document_analysis')).allowed,false);
}));
Deno.test('gate OFF preserves old native admin path with no network and getMyPlan returns unmanaged',()=>isolated(async db=>{
 Deno.env.set('BILLING_LIVE_ENFORCEMENT_ENABLED','false');globalThis.fetch=()=>{throw Error('no network allowed');};
 const r=await authorizePlanFeature(db,{id:'legacy',email:'admin@example.invalid',role:'admin'},'email_module');eq(r.allowed,true);eq(r.plan,'admin');
 const response=await endpoint(new Request('https://example.invalid',{method:'POST'}),{});eq(response.status,200);eq(await response.json(),{managed:false});
}));
Deno.test('fresh authorization bypasses cached allow after renewal or cancellation',()=>isolated(async(db,state)=>{
 const first=await authorizePlanFeature(db,user,'chat');eq(first.allowed,true);
 state.status='canceled';
 // Ordinary 5s cache still applies; explicit refresh must use provider truth.
 eq((await authorizePlanFeature(db,user,'chat')).allowed,true);
 eq((await authorizePlanFeature(db,user,'chat',{fresh:true})).allowed,false);
}));
