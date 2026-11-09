// ADMIN-reviewed path only. Do not call from public create/new-enrollment path.
// Exact existing phase-1 proof may be reused, but any differing identity/role
// aborts before either write. Native consent + admin evidence verified by caller.
export const REGISTER_REVIEWED_ENROLLMENT=`
local p = redis.call('GET',KEYS[1])
local e = redis.call('GET',KEYS[2])
local wantp = cjson.decode(ARGV[1])
local wante = cjson.decode(ARGV[2])
if p then
 local proof = cjson.decode(p)
 for k,v in pairs(wantp) do if proof[k] ~= v then return 0 end end
end
if e then
 local entry = cjson.decode(e)
 for k,v in pairs(wante) do if entry[k] ~= v then return 0 end end
end
if e and not p then return 0 end
redis.call('MSET',KEYS[1],ARGV[1],KEYS[2],ARGV[2])
return 1`;
export async function registerReviewedEnrollment(redis:(c:unknown[])=>Promise<unknown>,org:{id:string},member:{id:string;organization_id:string;google_sub:string;role:string;active:boolean}){
 const safe=(s:unknown)=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
 if(!safe(org.id)||!safe(member.id)||!safe(member.google_sub)||member.organization_id!==org.id||member.role!=='owner'||member.active!==true)throw Error('INVALID_ENROLLMENT');
 const proof={memberId:member.id,orgId:org.id,googleSub:member.google_sub,role:'owner'};
 const entry={version:1,orgId:org.id,memberId:member.id,googleSub:member.google_sub,role:'owner'};
 if(await redis(['EVAL',REGISTER_REVIEWED_ENROLLMENT,'2',`trucky:billing:member:v1:${org.id}:${member.google_sub}`,`trucky:billing:enrollment:v1:org:${org.id}`,JSON.stringify(proof),JSON.stringify(entry)])!==1)throw Error('ENROLLMENT_CONFLICT');
}
