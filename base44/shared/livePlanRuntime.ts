import {paidPlanCredit} from './paidPlanCredit.ts';
import {createLivePlanCache} from './livePlanCache.ts';
const cachedPlan=createLivePlanCache();
import {resolveLivePlan} from './livePlanPolicy.ts';
export async function livePlanForUser(base44:any,user:any){
 // OFF preserves all current users and avoids Redis/Stripe reads.
 if(Deno.env.get('BILLING_LIVE_ENFORCEMENT_ENABLED')!=='true')return {managed:false as const};
 const db=base44.asServiceRole.entities;
 const redis=liveBillingRedis;
 // Scope cache to authenticated identity AND current server price configuration.
 const cacheKey=JSON.stringify([user?.id,user?.email,Deno.env.get('STRIPE_LIVE_PRICE_OWNER_OP'),Deno.env.get('STRIPE_LIVE_PRICE_FLEET')]);
 return cachedPlan(cacheKey,()=>resolveLivePlan(user,{enabled:true,redis,members:q=>db.OrganizationMember.filter(q),orgs:id=>db.Organization.filter({id}),prices:{owner_op:Deno.env.get('STRIPE_LIVE_PRICE_OWNER_OP'),fleet:Deno.env.get('STRIPE_LIVE_PRICE_FLEET')},
  subscription:async id=>{
   const key=Deno.env.get('STRIPE_LIVE_SECRET_KEY');if(!key||!/^(sk|rk)_live_.+/.test(key))throw Error('LIVE_KEY_REQUIRED');
   if(typeof id!=='string'||!/^sub_[A-Za-z0-9]+$/.test(id))throw Error('LIVE_MAPPING_REQUIRED');
   const url=new URL(`https://api.stripe.com/v1/subscriptions/${id}`);url.searchParams.append('expand[]','latest_invoice');
   const r=await fetch(url,{redirect:'manual',headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(12000)}).catch(()=>{throw Error('LIVE_SUBSCRIPTION_UNAVAILABLE');});
   if(!r.ok||r.status>=300)throw Error('LIVE_SUBSCRIPTION_UNAVAILABLE');
   const sub=await r.json();
   const invoicesUrl=new URL('https://api.stripe.com/v1/invoices');invoicesUrl.searchParams.set('subscription',id);invoicesUrl.searchParams.set('status','paid');invoicesUrl.searchParams.set('limit','100');
   const invoicesResponse=await fetch(invoicesUrl,{redirect:'manual',headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(12000)}).catch(()=>{throw Error('LIVE_SUBSCRIPTION_UNAVAILABLE');});
   if(!invoicesResponse.ok||invoicesResponse.status>=300)throw Error('LIVE_SUBSCRIPTION_UNAVAILABLE');
   const invoices=await invoicesResponse.json();
   const credit=paidPlanCredit(sub,invoices.data||[],{owner_op:Deno.env.get('STRIPE_LIVE_PRICE_OWNER_OP'),fleet:Deno.env.get('STRIPE_LIVE_PRICE_FLEET')});
   return {...sub,verifiedPaidCredit:credit};
  },
 }));
}

export const liveBillingRedis=async(command:unknown[])=>{
  const url=Deno.env.get('CHECKOUT_REDIS_REST_URL'),token=Deno.env.get('CHECKOUT_REDIS_REST_TOKEN');
  if(!url||!token||new URL(url).protocol!=='https:')throw Error('REDIS_UNAVAILABLE');
  const r=await fetch(url,{method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(8000)}).catch(()=>{throw Error('REDIS_UNAVAILABLE');});
  if(!r.ok||r.status>=300)throw Error('REDIS_UNAVAILABLE');const data=await r.json();if(data.error||!Object.hasOwn(data,'result'))throw Error('REDIS_UNAVAILABLE');return data.result;
 };
