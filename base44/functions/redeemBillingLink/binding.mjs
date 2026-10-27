export const BIND_IDENTITIES = `
local native = redis.call('GET',KEYS[1])
local google = redis.call('GET',KEYS[2])
if (native and native ~= ARGV[1]) or (google and google ~= ARGV[2]) then return 0 end
redis.call('SET',KEYS[1],ARGV[1])
redis.call('SET',KEYS[2],ARGV[2])
return 1`;
export async function reserveNativeBinding(command, googleSub, nativeId) {
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(googleSub||'')||!/^[a-zA-Z0-9_-]{1,128}$/.test(nativeId||''))throw Error('INVALID_IDENTITY');
 const result=await command(['EVAL',BIND_IDENTITIES,'2',`trucky:billing:identity:v1:${googleSub}`,`trucky:billing:native:v1:${nativeId}`,nativeId,googleSub]);
 if(result!==1)throw Error('IDENTITY_ALREADY_BOUND');
}
