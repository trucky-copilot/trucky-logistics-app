export interface EligibilityDeps {
 enabled:boolean; syncEnabled:boolean; orgIds:Set<string>;memberIds:Set<string>;
 redis:(c:unknown[])=>Promise<unknown>;members:(q:Record<string,unknown>)=>Promise<any[]>;
 orgs:(id:string)=>Promise<any[]>;provenance:(redis:EligibilityDeps['redis'],m:any)=>Promise<void>;
}
export async function checkEligibility(sub:unknown,orgId:unknown,d:EligibilityDeps){
 const out=(code:string,status:number,details:Record<string,unknown>={})=>({status,body:{code,mode:'live',...details}});
 if(!d.enabled||!d.syncEnabled)return out('LIVE_CHECKOUT_NOT_READY',503);
 if(!d.orgIds.size||!d.memberIds.size)return out('PILOT_NOT_CONFIGURED',503);
 if(typeof sub!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(sub)||typeof orgId!=='string'||!d.orgIds.has(orgId))return out('PILOT_NOT_ALLOWED',403);
 try{
  const members=await d.members({organization_id:orgId,google_sub:sub,active:true});
  if(members.length!==1)return out('VERIFIED_MEMBERSHIP_REQUIRED',403);
  const m=members[0];
  if(!d.memberIds.has(m.id)||m.organization_id!==orgId||m.google_sub!==sub||m.active!==true||!['owner','admin'].includes(m.role))return out('PILOT_NOT_ALLOWED',403);
  await d.provenance(d.redis,m);
  if(typeof m.base44_user_id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(m.base44_user_id))return out('LIVE_IDENTITY_LINK_REQUIRED',409);
  if(await d.redis(['GET',`trucky:billing:identity:v1:${sub}`])!==m.base44_user_id||await d.redis(['GET',`trucky:billing:native:v1:${m.base44_user_id}`])!==sub)return out('IDENTITY_REQUIRES_REVIEW',409);
  const orgs=await d.orgs(orgId);if(orgs.length!==1||orgs[0].id!==orgId||orgs[0].active!==true)return out('ORGANIZATION_UNAVAILABLE',409);
  const org=orgs[0];
  // First live subscription only: cancellation/resubscription requires separate review.
  if(await d.redis(['EXISTS',`trucky:billing:sync:live:org:${orgId}`,`trucky:billing:sync:live:pending:org:${orgId}`])!==0)return out('LIVE_RECONCILIATION_PENDING',409);
  if(org.stripe_live_subscription_id||org.stripe_live_customer_id||org.stripe_live_price_id||org.stripe_live_sync_operation_id||org.stripe_live_subscription_status||org.stripe_live_plan_type)return out('ALREADY_SUBSCRIBED',409);
  return out('LIVE_CHECKOUT_ELIGIBLE',200,{organization_id:orgId,google_sub:sub,can_checkout:true});
 }catch{return out('LIVE_CHECKOUT_REQUIRES_REVIEW',503);}
}
