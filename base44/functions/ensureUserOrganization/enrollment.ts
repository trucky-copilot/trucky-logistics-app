// Server-only enrollment, distinct from demos, subscriptions and native identity bindings.
export type Redis = (command:unknown[])=>Promise<unknown>;
export type Enrollment={version:1;orgId:string;memberId:string;googleSub:string;role:'owner';origin?:'landing_public_new'};
const safe=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
export function enrollmentKey(orgId:string){if(!safe(orgId))throw Error('INVALID_ENROLLMENT');return `trucky:billing:enrollment:v1:org:${orgId}`;}
export async function readEnrollment(redis:Redis,orgId:unknown,enabled:boolean,sub?:unknown):Promise<Enrollment|null>{
 // Recognition survives closing new enrollment; enabled is retained for call compatibility.
 if(!safe(orgId))return null;
 const raw=await redis(['GET',enrollmentKey(orgId)]);if(raw==null)return null;
 const e=JSON.parse(String(raw));
 if(e?.version!==1||e.orgId!==orgId||!safe(e.memberId)||!safe(e.googleSub)||e.role!=='owner')throw Error('ENROLLMENT_REQUIRES_REVIEW');
 if(sub!==undefined&&e.googleSub!==sub)return null;
 return e;
}
export const REGISTER_ENROLLMENT=`
local p = redis.call('GET',KEYS[1])
local e = redis.call('GET',KEYS[2])
if p or e then
 if not p or not e then return 0 end
 local proof = cjson.decode(p)
 local entry = cjson.decode(e)
 local wantp = cjson.decode(ARGV[1])
 local wante = cjson.decode(ARGV[2])
 for k,v in pairs(wantp) do if proof[k] ~= v then return 0 end end
 for k,v in pairs(wante) do if entry[k] ~= v then return 0 end end
 return 1
end
redis.call('MSET',KEYS[1],ARGV[1],KEYS[2],ARGV[2])
return 1`;
export async function registerNewEnrollment(redis:Redis,org:{id:string},member:{id:string;organization_id:string;google_sub:string;role:string;active:boolean}){
 if(!safe(org.id)||!safe(member.id)||!safe(member.google_sub)||member.organization_id!==org.id||member.role!=='owner'||member.active!==true)throw Error('INVALID_ENROLLMENT');
 const proofKey=`trucky:billing:member:v1:${org.id}:${member.google_sub}`;
 const proof={memberId:member.id,orgId:org.id,googleSub:member.google_sub,role:'owner'};
 const entry:Enrollment={version:1,orgId:org.id,memberId:member.id,googleSub:member.google_sub,role:'owner',origin:'landing_public_new'};
 const result=await redis(['EVAL',REGISTER_ENROLLMENT,'2',proofKey,enrollmentKey(org.id),JSON.stringify(proof),JSON.stringify(entry)]);
 if(result!==1)throw Error('ENROLLMENT_CONFLICT');
}
export async function expandedScope(redis:Redis,orgId:unknown,enabled:boolean,orgIds:Set<string>,memberIds:Set<string>,sub?:unknown){
 const entry=await readEnrollment(redis,orgId,enabled,sub);
 return {entry,orgIds:new Set([...orgIds,...(entry?[entry.orgId]:[])]),memberIds:new Set([...memberIds,...(entry?[entry.memberId]:[])])};
}
