import {createClientFromRequest} from 'npm:@base44/sdk@0.8.54';
import Stripe from 'npm:stripe@23.0.0';
import {demoRedis} from './demoRegistry.ts';
import {assertMembershipProvenance} from './provenance.ts';
import {checkLinkedLiveSubscription} from './check.ts';
const parse=(value:string|undefined)=>new Set((value||'').split(',').map(s=>s.trim()).filter(s=>/^[A-Za-z0-9_-]{1,128}$/.test(s)));
export default async function handler(req:Request,_ctx:unknown){
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 const reply=(code:string,status:number)=>new Response(JSON.stringify({code,enforced:false}),{status,headers});
 if(req.method!=='POST')return reply('METHOD_NOT_ALLOWED',405);
 if(Deno.env.get('BILLING_SUBSCRIPTION_CHECK_ENABLED')!=='true')return reply('CHECK_NOT_ENABLED',503);
 try{
  let body:unknown;try{body=await req.json();}catch{return reply('INVALID_REQUEST',400);}
  const client=createClientFromRequest(req);const db=client.asServiceRole.entities;
  const result=await checkLinkedLiveSubscription(body,{
   enabled:true,orgIds:parse(Deno.env.get('BILLING_LINK_PILOT_ORG_IDS')),memberIds:parse(Deno.env.get('BILLING_LINK_PILOT_MEMBER_IDS')),
   prices:{owner_op:Deno.env.get('STRIPE_LIVE_PRICE_OWNER_OP'),fleet:Deno.env.get('STRIPE_LIVE_PRICE_FLEET')},
   getUser:()=>client.auth.me(),redis:demoRedis,assertProvenance:assertMembershipProvenance,
   members:q=>db.OrganizationMember.filter(q),organizations:id=>db.Organization.filter({id}),
   subscription:async id=>{
    const key=Deno.env.get('STRIPE_LIVE_SECRET_KEY');
    if(!key||!/^(sk|rk)_live_.+/.test(key))throw Error('LIVE_KEY_REQUIRED');
    return await new Stripe(key,{timeout:12000,maxNetworkRetries:0}).subscriptions.retrieve(id);
   },
  });
  return new Response(JSON.stringify(result.body),{status:result.status,headers});
 }catch{return reply('SUBSCRIPTION_CHECK_REQUIRES_REVIEW',503);}
}
