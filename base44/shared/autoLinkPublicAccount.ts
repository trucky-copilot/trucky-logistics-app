import {publicLandingAccount,landingOriginEvidence,safeId,type Redis} from './publicLandingAccount.ts';
import {conditionalIdentityWrite} from './publicMemberWrite.ts';
export interface Deps {redis:Redis;members:(q:any)=>Promise<any[]>;orgs:(q:any)=>Promise<any[]>;update:(q:any,f:any)=>Promise<any>}
export const AUTO_BIND_PUBLIC=`
local entry=redis.call('GET',KEYS[3])
local proof=redis.call('GET',KEYS[4])
if entry~=ARGV[3] or proof~=ARGV[4] or redis.call('GET',KEYS[6])~=ARGV[6] then return -1 end
local a=redis.call('GET',KEYS[1]);local b=redis.call('GET',KEYS[2])
if (a and a~=ARGV[1]) or (b and b~=ARGV[2]) then return 0 end
if a==ARGV[1] and b==ARGV[2] then return 1 end
redis.call('RPUSH',KEYS[5],ARGV[5])
redis.call('MSET',KEYS[1],ARGV[1],KEYS[2],ARGV[2])
return 1`;
export async function autoLinkPublicAccount(user:any,d:Deps){
 if(!safeId(user?.id)||typeof user.email!=='string')throw Error('NATIVE_SESSION_REQUIRED');
 // Platform auth.me() system field, never request body or editable user profile.
 if(user.is_verified!==true||user.disabled===true||user.is_service===true)return {code:'NATIVE_VERIFIED_EMAIL_REQUIRED',linked:false};
 const email=user.email.toLowerCase().trim();
 const members=await d.members({user_email:email,active:true});
 if(members.length!==1)return {code:'NO_UNIQUE_PUBLIC_ACCOUNT',linked:false};
 const m=members[0];
 if(typeof m.user_email!=='string'||m.user_email.toLowerCase().trim()!==email)return {code:'PUBLIC_ACCOUNT_MISMATCH',linked:false};
 const orgs=await d.orgs({id:m.organization_id});
 if(orgs.length!==1||!await publicLandingAccount(d.redis,orgs[0],m,d.members))return {code:'NOT_NEW_PUBLIC_ACCOUNT',linked:false};
 const org=orgs[0];
 if(typeof org.created_by_user!=='string'||org.created_by_user.toLowerCase().trim()!==email)return {code:'PUBLIC_ACCOUNT_MISMATCH',linked:false};
 const owned=await d.orgs({created_by_user:email});
 const native=await d.members({base44_user_id:user.id,active:true});
 if(owned.filter(o=>o.active!==false).some(o=>o.id!==org.id)||native.some(x=>x.id!==m.id))return {code:'NO_UNIQUE_PUBLIC_ACCOUNT',linked:false};
 if(m.base44_user_id!=null&&m.base44_user_id!==user.id)return {code:'IDENTITY_ALREADY_BOUND',linked:false};
 const entryKey=`trucky:billing:enrollment:v1:org:${org.id}`,proofKey=`trucky:billing:member:v1:${org.id}:${m.google_sub}`;
 const entry=await d.redis(['GET',entryKey]),proof=await d.redis(['GET',proofKey]);
 // Recheck EXACT values in Lua, not only the earlier snapshot.
 if(typeof entry!=='string'||typeof proof!=='string')throw Error('PUBLIC_ACCOUNT_REQUIRES_REVIEW');
 const parsed=JSON.parse(entry),p=JSON.parse(proof);
 if(parsed.orgId!==org.id||parsed.memberId!==m.id||parsed.googleSub!==m.google_sub||parsed.role!=='owner'||parsed.version!==1||p.memberId!==m.id||p.orgId!==org.id||p.googleSub!==m.google_sub||p.role!=='owner')throw Error('PUBLIC_ACCOUNT_REQUIRES_REVIEW');
 const evidence=await landingOriginEvidence(d.redis,org,m,parsed);if(!evidence)throw Error('PUBLIC_ORIGIN_REQUIRED');
 const evidenceValue=evidence.key===entryKey?entry:evidence.value;
 const reserved=await d.redis(['EVAL',AUTO_BIND_PUBLIC,'6',`trucky:billing:identity:v1:${m.google_sub}`,`trucky:billing:native:v1:${user.id}`,entryKey,proofKey,'trucky:billing:auto-link:public:audit',evidence.key,user.id,m.google_sub,entry,proof,JSON.stringify({event:'public_native_binding_reserved',orgId:org.id,memberId:m.id,nativeId:user.id,at:new Date().toISOString()}),evidenceValue]);
 if(reserved!==1)throw Error('PUBLIC_IDENTITY_BINDING_CONFLICT');
 if(m.base44_user_id!==user.id){
  const status=await conditionalIdentityWrite({updateMember:(q,f)=>d.update({...q,user_email:m.user_email},f),member:async id=>(await d.members({id}))[0]},m,org.id,{google_sub:m.google_sub,base44_user_id:user.id});
  if(status==='REJECTED')throw Error('PUBLIC_LINK_COMPLETION_PENDING');
 }
 return {code:'IDENTITY_LINKED',linked:true,organization_id:org.id};
}
