import {liveBillingRedis} from './livePlanRuntime.ts';
export const CONSUME_PAID_CHAT = `
local current = redis.call('HGET',KEYS[1],'invoice')
local lastPaid = tonumber(redis.call('HGET',KEYS[1],'paidAt') or '0')
local incoming = tonumber(ARGV[2])
if current and current ~= ARGV[1] and incoming <= lastPaid then return {-2,0} end
if current ~= ARGV[1] then
 redis.call('HSET',KEYS[1],'invoice',ARGV[1],'paidAt',ARGV[2])
end
local used=tonumber(redis.call('HGET',KEYS[2],'used') or '0')
if redis.call('HEXISTS',KEYS[2],'request:'..ARGV[4]) == 1 then return {-1,used} end
if used >= tonumber(ARGV[3]) then return {0,used} end
redis.call('HSET',KEYS[2],'request:'..ARGV[4],'reserved','used',used+1)
return {1,used+1}`;
export async function consumeLiveChat(access:any,requestId:unknown,redis=liveBillingRedis){
 // Only verified server credit reaches here. Test/demo/legacy unchanged.
 if(!access.credit)return {allowed:true,code:'LEGACY_QUOTA'};
 const safe=(x:unknown)=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
 const c=access.credit;
 if(!safe(requestId)||!safe(access.organizationId)||!safe(access.subscriptionId)||!/^in_[A-Za-z0-9]+$/.test(c.invoiceId)||!Number.isSafeInteger(c.paidAt)||!['plan_29','plan_99'].includes(access.plan))return {allowed:false,code:'INVALID_QUOTA_REQUEST'};
 const limit=access.plan==='plan_29'?1000:2000;
 const prefix=`trucky:billing:quota:live:${access.organizationId}:${access.subscriptionId}`;
 const result=await redis(['EVAL',CONSUME_PAID_CHAT,'2',`${prefix}:current`,`${prefix}:invoice:${c.invoiceId}`,c.invoiceId,String(c.paidAt),String(limit),requestId]);
 if(!Array.isArray(result)||result.length!==2)throw Error('QUOTA_REQUIRES_REVIEW');
 return {allowed:result[0]===1,code:result[0]===1?'CHAT_RESERVED':result[0]===0?'CHAT_QUOTA_EXHAUSTED':result[0]===-1?'CHAT_REQUEST_ALREADY_USED':'STALE_PAID_CREDIT',used:result[1],limit};
}

/** Only server-owned outcomes may settle a reservation; no public refund endpoint. */
export const SETTLE_PAID_CHAT = `
local field='request:'..ARGV[1]
local state=redis.call('HGET',KEYS[1],field)
if not state then return -1 end
if state ~= 'reserved' and state ~= '1' then return 0 end
local used=tonumber(redis.call('HGET',KEYS[1],'used') or '0')
if ARGV[2]=='confirmed_failure' and used < 1 then return -2 end
if ARGV[2]~='confirmed_failure' and ARGV[2]~='completed' and ARGV[2]~='uncertain' then return -3 end
redis.call('RPUSH',KEYS[2],ARGV[3])
if ARGV[2]=='confirmed_failure' then
 redis.call('HSET',KEYS[1],'used',used-1,field,'refunded')
else
 redis.call('HSET',KEYS[1],field,ARGV[2])
end
return 1`;
export type ChatOutcome='confirmed_failure'|'completed'|'uncertain';
export async function settleLiveChat(access:any,requestId:string,outcome:ChatOutcome,redis=liveBillingRedis){
 if(!access.credit)return {code:'LEGACY_QUOTA'};
 const safe=(s:unknown)=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
 if(!safe(requestId)||!safe(access.organizationId)||!safe(access.subscriptionId)||!/^in_[A-Za-z0-9]+$/.test(access.credit.invoiceId))throw Error('INVALID_QUOTA_SETTLEMENT');
 const prefix=`trucky:billing:quota:live:${access.organizationId}:${access.subscriptionId}`;
 const audit=JSON.stringify({event:'chat_quota_settled',organizationId:access.organizationId,subscriptionId:access.subscriptionId,invoiceId:access.credit.invoiceId,requestId,outcome,at:new Date().toISOString()});
 const result=await redis(['EVAL',SETTLE_PAID_CHAT,'2',`${prefix}:invoice:${access.credit.invoiceId}`,`${prefix}:audit`,requestId,outcome,audit]);
 if(result!==0&&result!==1)throw Error('QUOTA_SETTLEMENT_REQUIRES_REVIEW');
 return {code:result===0?'CHAT_ALREADY_SETTLED':outcome==='confirmed_failure'?'CHAT_REFUNDED':'CHAT_SETTLED'};
}

/** STALE means Lua made no reservation. One fresh authorization, same UUID. */
export async function reserveChatWithRefresh(access:any,requestId:unknown,fresh:()=>Promise<any>,redis=liveBillingRedis){
 let current=access;
 let quota=await consumeLiveChat(current,requestId,redis);
 if(quota.code==='STALE_PAID_CREDIT'){
  current=await fresh();
  // Never turn a previously managed paid operation into an unmetered legacy call.
  if(!current.allowed||!current.credit||current.organizationId!==access.organizationId||current.subscriptionId!==access.subscriptionId)return {access:current,quota:{allowed:false,code:'PAID_CREDIT_REFRESH_REQUIRED'}};
  quota=await consumeLiveChat(current,requestId,redis);
 }
 return {access:current,quota};
}
