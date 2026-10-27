import Stripe from 'npm:stripe@23.0.0';
import {demoRedis} from './demoRegistry.ts';
import {assertMembershipProvenance} from './provenance.mjs';
import {verifiedLivePlan} from './live-plan.mjs';
import {liveBillingDecision} from './policy.mjs';
export async function liveBillingGuard(req:Request,client:any):Promise<Response|null>{
 const deny=(code:string,status=403)=>new Response(JSON.stringify({code}),{status,headers:{'Content-Type':'application/json'}});
 if(Deno.env.get('BILLING_LIVE_ENFORCEMENT_ENABLED')!=='true')return null;
 try{
  const user=await client.auth.me();
  if(!user?.id)return deny('UNAUTHORIZED',401);
  // Only explicitly linked identities enter this new enforcement path.
  const marker=await demoRedis(['GET',`trucky:billing:native:v1:${user.id}`]);
  if(!marker)return null; // Preserve existing users until reviewed migration.
  const body=await req.clone().json().catch(()=>({}));
  const db=client.asServiceRole.entities;
  const members=await db.OrganizationMember.filter({base44_user_id:user.id,active:true});
  // Legacy operations use first membership by email. Reject ambiguity instead
  // of checking one tenant and operating against another.
  const all=await db.OrganizationMember.filter({user_email:user.email,active:true});
  const ids=[...new Set(all.map((m:any)=>m.organization_id))];
  if(ids.length!==1||!members.length)return deny('TENANT_SELECTION_REQUIRES_REVIEW');
  if(body.organization_id&&body.organization_id!==ids[0])return deny('TENANT_MISMATCH');
  const member=members.find((m:any)=>m.organization_id===ids[0]);
  if(!member||member.google_sub!==marker)return deny('IDENTITY_LINK_REQUIRED');
  if(await demoRedis(['GET',`trucky:billing:identity:v1:${marker}`])!==user.id)return deny('IDENTITY_LINK_REQUIRED');
  await assertMembershipProvenance(demoRedis,member);
  const org=(await db.Organization.filter({id:ids[0]}))?.[0];
  if(!org||org.active===false||!org.stripe_live_subscription_id)return deny('SUBSCRIPTION_REQUIRED',402);
  const key=Deno.env.get('STRIPE_LIVE_SECRET_KEY');
  if(!key||!/^(sk|rk)_live_.+/.test(key))return deny('BILLING_CONFIGURATION_REQUIRED',503);
  const sub=await new Stripe(key).subscriptions.retrieve(org.stripe_live_subscription_id);
  verifiedLivePlan(sub,{owner_op:Deno.env.get('STRIPE_LIVE_PRICE_OWNER_OP'),fleet:Deno.env.get('STRIPE_LIVE_PRICE_FLEET')});
  if(!liveBillingDecision(sub,org.id,org.stripe_live_customer_id).allowed)return deny('SUBSCRIPTION_REQUIRED',402);
  return null;
 }catch{return deny('BILLING_AUTHORIZATION_UNAVAILABLE',503);}
}
