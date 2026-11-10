// General account authorization. No email allowlist, role from the browser,
// pilot IDs or automatic legacy adoption. Trust comes from current server rows
// and exact server-owned provenance. Existing flags never become wildcards.
export type RedisCommand=(c:unknown[])=>Promise<unknown>;
export async function verifiedScope(
 redis:RedisCommand,findMembers:(q:Record<string,unknown>)=>Promise<any[]>,
 assertProvenance:(r:RedisCommand,m:any)=>Promise<void>,orgId:unknown,sub?:unknown,
){
 const empty=()=>({orgIds:new Set<string>(),memberIds:new Set<string>()});
 const safe=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
 if(!safe(orgId)||(sub!==undefined&&!safe(sub)))return empty();
 const rows=await findMembers({organization_id:orgId,active:true,...(sub!==undefined?{google_sub:sub}:{})});
 const valid=[];
 for(const m of rows){
  if(m.organization_id!==orgId||m.active!==true||!safe(m.id)||!safe(m.google_sub)||!['owner','admin'].includes(m.role)||(sub!==undefined&&m.google_sub!==sub))continue;
  if(sub===undefined&&m.role!=='owner')continue; // Reconcile through the canonical owner, not every billing admin.
  try{await assertProvenance(redis,m);}
  catch(error){
   if(error instanceof Error&&error.message==='MEMBERSHIP_PROVENANCE_REQUIRED'){
    if(sub===undefined)continue; // Unproven co-owner cannot block the unique proven owner.
    throw Error('BILLING_ACCOUNT_REVIEW_REQUIRED');
   }
   throw error; // Mismatch, malformed proof and Redis failures are NOT skippable.
  }
  valid.push(m);
 }
 // Subscription reconciliation has no user token; require one canonical billing
 // owner. User-specific queries can select exactly their single membership.
 if(valid.length!==1)return empty();
 return {orgIds:new Set([String(orgId)]),memberIds:new Set([valid[0].id])};
}
