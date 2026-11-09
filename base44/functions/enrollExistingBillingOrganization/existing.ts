import {readEnrollment} from './enrollment.ts';
import {registerReviewedEnrollment} from './reviewedEnrollment.ts';
export interface Deps {
 enabled:boolean;adminIds:Set<string>;trustedServer:()=>Promise<boolean>;native:()=>Promise<any>;google:(token:string)=>Promise<any>;
 member:(id:string)=>Promise<any>;org:(id:string)=>Promise<any>;owners:(id:string)=>Promise<any[]>;
 redis:(c:unknown[])=>Promise<unknown>;updateMember:(query:Record<string,unknown>,fields:Record<string,unknown>)=>Promise<{updated?:number}>;
 id:()=>string;now:()=>number;
}
const safe=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const approvalKey=(id:string)=>`trucky:billing:existing:v1:approval:${id}`;
const audit='trucky:billing:existing:v1:audit';
const out=(code:string,status=200,extra:Record<string,unknown>={})=>({status,body:{code,...extra}});
// One-use approval and audit are recorded atomically; if RPUSH fails, no consume.
const consume=`if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('RPUSH',KEYS[2],ARGV[2]); redis.call('DEL',KEYS[1]); return 1`;
async function records(body:any,d:Deps){
 const member=await d.member(body.member_id),org=await d.org(body.organization_id);
 const owners=await d.owners(body.organization_id);
 if(!member||!org||member.organization_id!==org.id||member.active!==true||member.role!=='owner'||org.active!==true||owners.length!==1||owners[0].id!==member.id)throw Error('OWNERSHIP_REQUIRES_REVIEW');
 return {member,org};
}
export async function enrollExisting(body:any,d:Deps){
 if(!d.enabled)return out('EXISTING_ENROLLMENT_DISABLED',503);
 try{
  if(!body||!safe(body.organization_id)||!safe(body.member_id))return out('INVALID_REQUEST',400);
  if(body.mode==='owner_approval'){
   if(!await d.trustedServer())return out('SERVER_AUTH_REQUIRED',401);
   if(body.owner_consent!==true||typeof body.google_id_token!=='string'||body.google_id_token.length>4096)return out('CONSENT_REQUIRED',400);
   const google=await d.google(body.google_id_token).catch(()=>null);
   if(!safe(google?.sub)||google.email_verified!==true||typeof google.iat!=='number'||!Number.isFinite(google.iat)||google.iat>d.now()/1000+30||d.now()/1000-google.iat>600)return out('GOOGLE_AUTHORIZATION_REQUIRED',401);
   const {member,org}=await records(body,d);
   // Candidate only. No enrollment or identity assignment until native consent AND admin review.
   if(String(member.user_email).toLowerCase()!==String(google.email).toLowerCase()||String(org.created_by_user).toLowerCase()!==String(google.email).toLowerCase()||(member.google_sub&&member.google_sub!==google.sub))return out('OWNERSHIP_REQUIRES_REVIEW',403);
   const id=d.id();if(!safe(id))throw Error('invalid generated id');
   const approval={version:1,requestId:id,orgId:org.id,memberId:member.id,googleSub:google.sub,googleEmail:google.email.toLowerCase(),approvedAt:d.now()};
   if(await d.redis(['SET',`trucky:billing:existing:v1:owner:${id}`,JSON.stringify(approval),'NX','EX','600'])!=='OK')return out('APPROVAL_CONFLICT',409);
   return out('EXISTING_GOOGLE_APPROVAL_RECORDED',200,{request_id:id});
  }
  const caller=await d.native().catch(()=>null);if(!safe(caller?.id))return out('NATIVE_SESSION_REQUIRED',401);
  if(body.mode==='request'){
   if(body.owner_consent!==true||!safe(body.request_id)||'google_id_token' in body)return out('CONSENT_REQUIRED',400);
   const ownerKey=`trucky:billing:existing:v1:owner:${body.request_id}`;
   const raw=await d.redis(['GET',ownerKey]);if(!raw)return out('OWNER_APPROVAL_REQUIRED',409);
   const owner=JSON.parse(String(raw));
   if(owner.orgId!==body.organization_id||owner.memberId!==body.member_id||owner.version!==1||!safe(owner.googleSub)||!Number.isFinite(owner.approvedAt)||owner.approvedAt>d.now()||d.now()-owner.approvedAt>=600000)return out('APPROVAL_INVALID',409);
   if(typeof caller.email!=='string'||owner.googleEmail!==caller.email.toLowerCase())return out('IDENTITY_MISMATCH',403);
   const {member}=await records(body,d);
   if((member.google_sub&&member.google_sub!==owner.googleSub)||(member.base44_user_id&&member.base44_user_id!==caller.id))return out('IDENTITY_CONFLICT',409);
   const got=await d.redis(['GETDEL',ownerKey]);if(got!==raw)return out('APPROVAL_ALREADY_USED',409);
   const approval={...owner,nativeId:caller.id,googleApprovedAt:owner.approvedAt,approvedAt:d.now()};delete approval.googleEmail;
   if(await d.redis(['SET',approvalKey(body.request_id),JSON.stringify(approval),'NX','EX','900'])!=='OK')return out('APPROVAL_CONFLICT',409);
   return out('EXISTING_OWNER_APPROVAL_RECORDED',200,{request_id:body.request_id,expires_at:new Date(d.now()+900000).toISOString()});
  }
  if(!['preview','execute'].includes(body.mode)||!safe(body.request_id))return out('INVALID_REQUEST',400);
  if(caller.role!=='admin'||!d.adminIds.has(caller.id))return out('ADMIN_NOT_AUTHORIZED',403);
  if('google_id_token' in body)return out('TOKEN_NOT_ACCEPTED_FROM_ADMIN',400);
  const raw=await d.redis(['GET',approvalKey(body.request_id)]);if(!raw)return out('OWNER_APPROVAL_REQUIRED',409);
  const a=JSON.parse(String(raw));
  if(a.version!==1||a.requestId!==body.request_id||a.orgId!==body.organization_id||a.memberId!==body.member_id||!safe(a.googleSub)||!safe(a.nativeId)||!Number.isFinite(a.approvedAt)||d.now()-a.approvedAt>=900000||a.approvedAt>d.now())return out('APPROVAL_INVALID',409);
  const {member,org}=await records(body,d);
  if((member.google_sub&&member.google_sub!==a.googleSub)||(member.base44_user_id&&member.base44_user_id!==a.nativeId))return out('IDENTITY_CONFLICT',409);
  const mappedNative=await d.redis(['GET',`trucky:billing:identity:v1:${a.googleSub}`]);
  const mappedGoogle=await d.redis(['GET',`trucky:billing:native:v1:${a.nativeId}`]);
  if((mappedNative&&mappedNative!==a.nativeId)||(mappedGoogle&&mappedGoogle!==a.googleSub))return out('IDENTITY_CONFLICT',409);
  const enrolled=await readEnrollment(d.redis,org.id,true);
  if(enrolled&&(enrolled.memberId!==member.id||enrolled.googleSub!==a.googleSub))return out('ENROLLMENT_CONFLICT',409);
  if(body.mode==='preview')return out('EXISTING_ENROLLMENT_READY',200,{organization_id:org.id,member_id:member.id,native_user_id:a.nativeId,google_sub:a.googleSub});
  // The administrator must independently review server records / account history
  // establishing native ownership; a matching email is explicitly not evidence.
  if(body.confirm!==`ENROLL ${member.id}`||body.ownership_verified!==true||typeof body.evidence_reference!=='string'||!/^[A-Za-z0-9_.:-]{8,120}$/.test(body.evidence_reference))return out('ADMIN_REVIEW_REQUIRED',400);
  const event=JSON.stringify({event:'existing_enrollment_approved',requestId:a.requestId,adminId:caller.id,orgId:org.id,memberId:member.id,nativeId:a.nativeId,googleSub:a.googleSub,at:d.now(),evidenceReference:body.evidence_reference});
  if(await d.redis(['EVAL',consume,'2',approvalKey(a.requestId),audit,String(raw),event])!==1)return out('APPROVAL_ALREADY_USED',409);
  // Pin exact IDs/role/active AND prior values so concurrent ownership changes
  // cannot be overwritten. updateMany single-id condition is checked at write.
  const query={id:member.id,organization_id:org.id,role:'owner',active:true,google_sub:member.google_sub??null,base44_user_id:member.base44_user_id??null};
  const write=await d.updateMember(query,{google_sub:a.googleSub,base44_user_id:a.nativeId});
  if(write?.updated!==1)return out('EXISTING_ENROLLMENT_REQUIRES_REVIEW',503);
  await registerReviewedEnrollment(d.redis,org,{...member,google_sub:a.googleSub,base44_user_id:a.nativeId});
  // Normal redeem/link flow still creates/checks global bidirectional binding.
  return out('EXISTING_ENROLLMENT_RECORDED');
 }catch{return out('EXISTING_ENROLLMENT_REQUIRES_REVIEW',503);}
}
