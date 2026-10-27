import { demoRedis } from "./demoRegistry.ts";
import { verifiedLivePlan } from "./live-plan.mjs";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import Stripe from 'npm:stripe@23.0.0';
import { liveBillingDecision } from './policy.mjs';
export default async function getLiveBillingAccess(req: Request,_ctx:unknown){
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='POST')return reply({code:'METHOD_NOT_ALLOWED'},405);
 if(Deno.env.get('BILLING_LIVE_ACCESS_CHECK_ENABLED')!=='true')return reply({code:'CHECK_NOT_ENABLED'},503);
 try{
  const client=createClientFromRequest(req);
  const user=await client.auth.me();
  if(!user?.id)return reply({code:'UNAUTHORIZED'},401);
  const body=await req.json();
  if(typeof body.organization_id!=='string')return reply({code:'ORGANIZATION_REQUIRED'},400);
  const db=client.asServiceRole.entities;
  // Require server-established native identity binding, not email alone.
  const members=await db.OrganizationMember.filter({organization_id:body.organization_id,base44_user_id:user.id,active:true});
  if(!members?.length)return reply({code:'VERIFIED_MEMBERSHIP_REQUIRED'},403);
  const verified=[];
  for(const member of members){
    if(typeof member.google_sub==='string' &&
      await demoRedis(['GET',`trucky:billing:identity:v1:${member.google_sub}`])===user.id) verified.push(member);
  }
  if(!verified.length)return reply({code:'IDENTITY_LINK_REQUIRED'},403);
  const org=(await db.Organization.filter({id:body.organization_id}))?.[0];
  if(!org||org.active===false)return reply({code:'ORGANIZATION_UNAVAILABLE'},403);
  if(!org.stripe_live_subscription_id)return reply({allowed:false,reason:'NO_LIVE_SUBSCRIPTION'});
  const key=Deno.env.get('STRIPE_LIVE_SECRET_KEY');
  if(!key || !/^(sk|rk)_live_.+/.test(key || ''))return reply({code:'LIVE_CONFIGURATION_REQUIRED'},503);
  const stripe=new Stripe(key);
  const subscription=await stripe.subscriptions.retrieve(org.stripe_live_subscription_id);
  const plan=verifiedLivePlan(subscription,{owner_op:Deno.env.get('STRIPE_LIVE_PRICE_OWNER_OP'),fleet:Deno.env.get('STRIPE_LIVE_PRICE_FLEET')});
  const access=liveBillingDecision(subscription,org.id,org.stripe_live_customer_id);
  return reply({...access,...(access.allowed?{plan:plan.live_plan_code}:{})});

 }catch{return reply({code:'BILLING_CHECK_UNAVAILABLE'},503);}
}
