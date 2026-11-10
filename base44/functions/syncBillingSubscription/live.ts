import {publicLandingAccount} from '../../shared/publicLandingAccount.ts';
// Only invoked after S2S authentication in entry.ts. Never creates charges or grants app access.
import {
  type Command, lockKey, pendingKey, makeOwner, pickLiveFields,
  RELEASE_LOCK_SCRIPT, RELEASE_LOCK_AND_PENDING_SCRIPT, SET_PENDING_IF_OWNER_SCRIPT, OP_FIELD, WRITE_METHOD,
} from './lock.ts';
export type { Command };
export interface LiveDeps {
 enabled:boolean; orgIds:Set<string>; memberIds:Set<string>; prices:{owner_op?:string;fleet?:string};
 redis:Command; assertProvenance:(redis:Command,member:any)=>Promise<void>;
 members:(q:Record<string,unknown>)=>Promise<any[]>; organizations:(id:string)=>Promise<any[]>;
 retrieve:(id:string)=>Promise<any>;
 /** Escritura de UN registro en una sola operación: Organization.updateMany({id},{$set}) → {updated}. */
 update:(id:string,fields:Record<string,unknown>)=>Promise<{updated?:unknown}|unknown>;
 owner:()=>string;
 /** Hora actual en ms (inyectada para las pruebas). */
 now?:()=>number;
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
 const nowMs=(d.now??Date.now)();
 const lock=lockKey(body.organization_id);
 const pending=pendingKey(body.organization_id);
 let acquired=false,writeStarted=false,done=false;const owner=makeOwner(nowMs,d.owner());
 try{
  // No TTL: an unknown DB write must not silently unlock and allow stale overwrites.
  acquired=await d.redis(['SET',lock,owner,'NX'])==='OK';
  if(!acquired)return res('LIVE_RECONCILIATION_BUSY',503);
  // A leftover pending write (from a recovered/inconsistent state) must be reviewed, never overwritten.
  if(await d.redis(['GET',pending])!=null)return res('LIVE_RECOVERY_REQUIRED',409);
  const orgs=await d.organizations(body.organization_id);
  if(orgs.length!==1||orgs[0].id!==body.organization_id||orgs[0].active!==true)return res('ORGANIZATION_NOT_FOUND',404);
  const org=orgs[0];
  const members=await d.members({organization_id:org.id,active:true});
  const verified=members.filter(m=>d.memberIds.has(m.id)&&m.organization_id===org.id&&m.active===true&&['owner','admin'].includes(m.role));
  if(verified.length!==1)return res('VERIFIED_MEMBERSHIP_REQUIRED',403);
  const member=verified[0];
  if(!safe(member.google_sub))return res('IDENTITY_NOT_LINKED',403);
  await d.assertProvenance(d.redis,member);
  const publicNew=await publicLandingAccount(d.redis,org,member,d.members);
  if(!publicNew||member.base44_user_id!=null){
   if(!safe(member.base44_user_id))return res('IDENTITY_NOT_LINKED',403);
  if(await d.redis(['GET',`trucky:billing:identity:v1:${member.google_sub}`])!==member.base44_user_id||await d.redis(['GET',`trucky:billing:native:v1:${member.base44_user_id}`])!==member.google_sub)return res('IDENTITY_REQUIRES_REVIEW',409);
  }
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
  // Paid plans do not carry a free month: reject an ACTIVE or FUTURE trial only.
  // A historical trial that already ended (trial_end in the past) is allowed.
  const trialEndMs=typeof sub.trial_end==='number'?sub.trial_end*1000:null;
  if(sub.status==='trialing'||(trialEndMs!==null&&trialEndMs>nowMs))return res('LIVE_TRIAL_NOT_ALLOWED',409);
  if(!['active','past_due','unpaid','canceled','incomplete','incomplete_expired','paused'].includes(sub.status))return res('STATUS_REQUIRES_MIGRATION',409);
  const fields={stripe_live_subscription_id:sub.id,stripe_live_customer_id:customer,stripe_live_price_id:price.id,
   stripe_live_plan_type:plan,stripe_live_subscription_status:sub.status};
  // Record the intended write BEFORE touching Base44, so an uncertain outcome can be reviewed.
  // Fencing: only the current lock owner may record (and then perform) the write.
  const pendingSet=await d.redis(['EVAL',SET_PENDING_IF_OWNER_SCRIPT,'2',lock,pending,owner,
   JSON.stringify({owner,orgId:org.id,subscriptionId:sub.id,writeMethod:WRITE_METHOD,fields,before:pickLiveFields(org),startedAt:new Date(nowMs).toISOString()})]);
  if(pendingSet===0)return res('LIVE_LOCK_LOST',409);
  if(pendingSet!==1)return res('LIVE_RECOVERY_REQUIRED',409);
  writeStarted=true;
  // ONE single-record write ($set via updateMany, documented as a single write per
  // record): the 5 live fields AND this operation's unique id. Recovery treats the
  // write as finished only if it sees this exact id.
  const written:any=await d.update(org.id,{...fields,[OP_FIELD]:owner});
  // Anything other than exactly one record written is uncertain: keep lock and pending.
  if(written?.updated!==1)throw Error('WRITE_NOT_CONFIRMED');
  done=true;
  return res('SUBSCRIPTION_RECONCILED');
 }catch{return res(writeStarted?'LIVE_WRITE_REQUIRES_REVIEW':'LIVE_RECONCILIATION_REQUIRED',503);}
 finally{
  if(acquired&&(!writeStarted||done)){
   try{
    // Completed write: release lock + our own pending atomically. No write: release only the lock.
    if(done)await d.redis(['EVAL',RELEASE_LOCK_AND_PENDING_SCRIPT,'2',lock,pending,owner]);
    else await d.redis(['EVAL',RELEASE_LOCK_SCRIPT,'1',lock,owner]);
   }catch{/* If unlock outcome is unknown, preserve lock and stop future writes. */}
  }
 }
}
