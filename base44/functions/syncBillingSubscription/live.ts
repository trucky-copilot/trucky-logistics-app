// Only invoked after S2S authentication in entry.ts. Never creates charges or grants app access.
export type Command = (command:unknown[])=>Promise<unknown>;
export interface LiveDeps {
 enabled:boolean; orgIds:Set<string>; memberIds:Set<string>; prices:{owner_op?:string;fleet?:string};
 redis:Command; assertProvenance:(redis:Command,member:any)=>Promise<void>;
 members:(q:Record<string,unknown>)=>Promise<any[]>; organizations:(id:string)=>Promise<any[]>;
 retrieve:(id:string)=>Promise<any>; update:(id:string,fields:Record<string,unknown>)=>Promise<unknown>;
 owner:()=>string;
}
const res=(code:string,status=200)=>({status,body:{code,mode:'live'}});
const safe=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
export async function reconcileLiveSubscription(body:any,d:LiveDeps){
 if(!d.enabled)return res('SYNC_NOT_ENABLED',503);
 if(!d.orgIds.size||!d.memberIds.size)return res('LIVE_PILOT_NOT_CONFIGURED',503);
 if(body?.mode!=='live'||!safe(body?.organization_id)||!/^sub_[A-Za-z0-9]+$/.test(body?.subscription_id||''))return res('INVALID_LIVE_REQUEST',400);
 if(!d.orgIds.has(body.organization_id))return res('LIVE_ORGANIZATION_NOT_ALLOWED',403);
 const {owner_op,fleet}=d.prices;
 if(!/^price_[A-Za-z0-9]+$/.test(owner_op||'')||!/^price_[A-Za-z0-9]+$/.test(fleet||'')||owner_op===fleet)return res('LIVE_CONFIGURATION_REQUIRED',503);
 const lock=`trucky:billing:sync:live:org:${body.organization_id}`;
 let acquired=false,writeStarted=false,done=false;const owner=d.owner();
 try{
  // No TTL: an unknown DB write must not silently unlock and allow stale overwrites.
  acquired=await d.redis(['SET',lock,owner,'NX'])==='OK';
  if(!acquired)return res('LIVE_RECONCILIATION_BUSY',503);
  const orgs=await d.organizations(body.organization_id);
  if(orgs.length!==1||orgs[0].id!==body.organization_id||orgs[0].active!==true)return res('ORGANIZATION_NOT_FOUND',404);
  const org=orgs[0];
  const members=await d.members({organization_id:org.id,active:true});
  const verified=members.filter(m=>d.memberIds.has(m.id)&&m.organization_id===org.id&&m.active===true&&['owner','admin'].includes(m.role));
  if(verified.length!==1)return res('VERIFIED_MEMBERSHIP_REQUIRED',403);
  const member=verified[0];
  if(!safe(member.google_sub)||!safe(member.base44_user_id))return res('IDENTITY_NOT_LINKED',403);
  await d.assertProvenance(d.redis,member);
  if(await d.redis(['GET',`trucky:billing:identity:v1:${member.google_sub}`])!==member.base44_user_id||await d.redis(['GET',`trucky:billing:native:v1:${member.base44_user_id}`])!==member.google_sub)return res('IDENTITY_REQUIRES_REVIEW',409);
  // Fetch canonical state inside the lock; never use status/customer/plan supplied in the request.
  const sub=await d.retrieve(body.subscription_id);
  const customer=typeof sub.customer==='string'?sub.customer:sub.customer?.id;
  if(sub.id!==body.subscription_id||sub.livemode!==true||sub.metadata?.org_id!==org.id||!/^cus_[A-Za-z0-9]+$/.test(customer||''))return res('SUBSCRIPTION_MISMATCH',409);
  if((org.stripe_live_subscription_id&&org.stripe_live_subscription_id!==sub.id)||(org.stripe_live_customer_id&&org.stripe_live_customer_id!==customer))return res('BILLING_MAPPING_CONFLICT',409);
  const items=sub.items?.data;
  if(!Array.isArray(items)||items.length!==1||sub.items?.has_more||items[0].quantity!==1)return res('LIVE_PLAN_MISMATCH',409);
  const price=items[0].price;
  const plan=price?.id===owner_op?'owner_op':price?.id===fleet?'fleet':null;
  if(!plan||price.livemode!==true||price.currency!=='usd'||price.unit_amount!==(plan==='owner_op'?2900:9900)||price.type!=='recurring'||price.recurring?.interval!=='month'||price.recurring.interval_count!==1||price.billing_scheme!=='per_unit')return res('LIVE_PLAN_MISMATCH',409);
  // Paid plans do not carry the free demo. Reject accidental Stripe trials without projecting active access.
  if(sub.trial_start||sub.trial_end||sub.status==='trialing')return res('LIVE_TRIAL_NOT_ALLOWED',409);
  if(!['active','past_due','unpaid','canceled','incomplete','incomplete_expired','paused'].includes(sub.status))return res('STATUS_REQUIRES_MIGRATION',409);
  const fields={stripe_live_subscription_id:sub.id,stripe_live_customer_id:customer,stripe_live_price_id:price.id,
   stripe_live_plan_type:plan,stripe_live_subscription_status:sub.status};
  writeStarted=true;
  await d.update(org.id,fields);
  done=true;
  return res('SUBSCRIPTION_RECONCILED');
 }catch{return res(writeStarted?'LIVE_WRITE_REQUIRES_REVIEW':'LIVE_RECONCILIATION_REQUIRED',503);}
 finally{
  if(acquired&&(!writeStarted||done)){
   try{await d.redis(['EVAL',"if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",'1',lock,owner]);}catch{/* If unlock outcome is unknown, preserve lock and stop future writes. */}
  }
 }
}
