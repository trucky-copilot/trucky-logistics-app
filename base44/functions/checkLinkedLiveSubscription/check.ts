// Diagnostic only: never changes access, calls a write API, or creates a subscription.
export type Member = {id:string;organization_id:string;google_sub:string;base44_user_id?:string;role:string;active:boolean};
export type Command = (command:unknown[])=>Promise<unknown>;
export interface Deps {
 enabled:boolean; orgIds:Set<string>; memberIds:Set<string>; prices:{owner_op?:string;fleet?:string};
 getUser:()=>Promise<{id?:string}|null>; redis:Command;
 members:(query:Record<string,unknown>)=>Promise<Member[]>;
 assertProvenance:(redis:Command,member:Member)=>Promise<void>;
 organizations:(id:string)=>Promise<any[]>;
 subscription:(id:string)=>Promise<any>;
}
const safeId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const reply=(code:string,status=200,details:Record<string,unknown>={})=>({status,body:{code,enforced:false,...details}});
export async function checkLinkedLiveSubscription(body:unknown,deps:Deps){
 if(!deps.enabled)return reply('CHECK_NOT_ENABLED',503);
 if(!deps.orgIds.size||!deps.memberIds.size)return reply('PILOT_NOT_CONFIGURED',503);
 try{
  const user=await deps.getUser();if(!safeId(user?.id))return reply('NATIVE_SESSION_REQUIRED',401);
  const input=body as Record<string,unknown>|null;
  if(!input||!safeId(input.organization_id)||Object.keys(input).some(k=>k!=='organization_id'))return reply('INVALID_REQUEST',400);
  const orgId=input.organization_id;
  if(!deps.orgIds.has(orgId))return reply('PILOT_NOT_ALLOWED',403);
  const sub=await deps.redis(['GET',`trucky:billing:native:v1:${user.id}`]);
  if(!safeId(sub))return reply('IDENTITY_NOT_LINKED',403);
  if(await deps.redis(['GET',`trucky:billing:identity:v1:${sub}`])!==user.id)return reply('IDENTITY_REQUIRES_REVIEW',409);
  const members=await deps.members({organization_id:orgId,google_sub:sub,base44_user_id:user.id,active:true});
  if(members.length!==1)return reply('VERIFIED_MEMBERSHIP_REQUIRED',403);
  const member=members[0];
  if(!deps.memberIds.has(member.id)||member.organization_id!==orgId||member.google_sub!==sub||member.base44_user_id!==user.id||member.active!==true||!['owner','admin'].includes(member.role))return reply('PILOT_NOT_ALLOWED',403);
  await deps.assertProvenance(deps.redis,member);
  const orgs=await deps.organizations(orgId);
  if(orgs.length!==1||orgs[0].id!==orgId||orgs[0].active!==true)return reply('ORGANIZATION_UNAVAILABLE',409);
  const org=orgs[0];
  // Never fall back to stripe_subscription_id / stripe_customer_id (test fields).
  if(!org.stripe_live_subscription_id)return reply('LIVE_SUBSCRIPTION_NOT_RECORDED');
  if(!/^sub_[A-Za-z0-9]+$/.test(org.stripe_live_subscription_id)||!/^cus_[A-Za-z0-9]+$/.test(org.stripe_live_customer_id||''))return reply('LIVE_RECORD_REQUIRES_REVIEW',409);
  const {owner_op,fleet}=deps.prices;
  if(!/^price_[A-Za-z0-9]+$/.test(owner_op||'')||!/^price_[A-Za-z0-9]+$/.test(fleet||'')||owner_op===fleet)return reply('LIVE_PRICES_NOT_CONFIGURED',503);
  const stripeSub=await deps.subscription(org.stripe_live_subscription_id);
  const customer=typeof stripeSub.customer==='string'?stripeSub.customer:stripeSub.customer?.id;
  if(stripeSub.id!==org.stripe_live_subscription_id||stripeSub.livemode!==true||stripeSub.metadata?.org_id!==orgId||customer!==org.stripe_live_customer_id)return reply('LIVE_SUBSCRIPTION_MISMATCH',409);
  const items=stripeSub.items?.data;
  if(!Array.isArray(items)||items.length!==1||stripeSub.items?.has_more||items[0].quantity!==1)return reply('LIVE_PLAN_MISMATCH',409);
  const price=items[0].price;
  const plan=price?.id===owner_op?'owner_op':price?.id===fleet?'fleet':null;
  if(!plan||price.livemode!==true||price.currency!=='usd'||price.unit_amount!==(plan==='owner_op'?2900:9900)||price.type!=='recurring'||price.recurring?.interval!=='month'||price.recurring?.interval_count!==1||price.billing_scheme!=='per_unit')return reply('LIVE_PLAN_MISMATCH',409);
  // Report truthfully, but do NOT return an "access granted" decision or conflate active with invoice.paid.
  const statuses=['active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused'];
  if(!statuses.includes(stripeSub.status))return reply('LIVE_STATE_REQUIRES_REVIEW',409);
  return reply('LIVE_SUBSCRIPTION_INSPECTED',200,{plan,status:stripeSub.status,has_trial:!!stripeSub.trial_end});
 }catch{return reply('SUBSCRIPTION_CHECK_REQUIRES_REVIEW',503);}
}
