export const CREATION_QUOTA = `
local n=tonumber(redis.call('GET',KEYS[1]) or '0')
if n >= tonumber(ARGV[1]) then return 0 end
n=redis.call('INCR',KEYS[1])
if n==1 then redis.call('EXPIRE',KEYS[1],86400) end
return 1`;
export const RELEASE_CREATION = "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
export const FINISH_CREATION = "if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1";
export async function takeCreation(redis:(c:unknown[])=>Promise<unknown>,sub:string,name:string,owner:string){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${sub}:${name.toLowerCase()}`));
 const hash=Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,'0')).join('');
 // Quota must reject before acquiring a pending lock. A failed lock attempt may
 // consume quota; it does not consume a company/trial or authorize a retry.
 if(await redis(['EVAL',CREATION_QUOTA,'1',`trucky:billing:create:v1:quota:${sub}`,'3'])!==1)return {code:'BILLING_CREATION_LIMIT',status:429,key:null};
 const key=`trucky:billing:create:v1:attempt:${hash}`;
 if(await redis(['SET',key,owner,'NX'])!=='OK')return {code:'BILLING_CREATION_REQUIRES_RECONCILIATION',status:409,key:null};
 return {code:'OK',status:200,key};
}
