// Sole exception to positive-payment credit. Receipt is written by the landing
// and bound by its signed Stripe webhook. Never accept a browser code/flag here.
export async function academyPlanCredit(sub:any,invoices:any[],prices:{owner_op?:string;fleet?:string},redis:(c:unknown[])=>Promise<unknown>,now=Date.now()){
 const fail=()=>{throw Error('PAID_PLAN_CREDIT_REQUIRED');};
 const m=sub?.metadata;
 if(!sub?.livemode||sub.status!=='active'||m?.academy_offer!=='ACADEMY'||!/^[a-f0-9]{64}$/.test(m.academy_account||'')||!m.org_id||!m.reservation_id)return fail();
 const raw=await redis(['GET',`trucky:billing:academy:v1:account:${m.academy_account}`]);
 if(typeof raw!=='string')return fail();
 const receipt=JSON.parse(raw);
 if(receipt.orgId!==m.org_id||receipt.attemptId!==m.reservation_id||receipt.subscriptionId!==sub.id||receipt.priceId!==prices.owner_op||typeof receipt.couponId!=='string')return fail();
 const refId=(v:any)=>typeof v==='string'?v:v?.id;
 const customer=refId(sub.customer);
 const candidates=[];
 for(const i of invoices){
  if(i?.livemode!==true||i.status!=='paid'||i.currency!=='usd'||i.amount_paid!==0||i.amount_due!==0||i.total!==0||i.billing_reason!=='subscription_create'||!/^in_[A-Za-z0-9]+$/.test(i.id||'')||refId(i.parent?.subscription_details?.subscription??i.subscription)!==sub.id||refId(i.customer)!==customer)continue;
  if(i.lines?.has_more||i.lines?.data?.length!==1||i.discounts?.length!==1||i.total_discount_amounts?.length!==1)continue;
  const line=i.lines.data[0],discount=i.discounts[0],coupon=discount?.source?.coupon??discount?.coupon;
  const details=i.total_discount_amounts[0];
  if(typeof discount!=='object'||discount.deleted||refId(coupon)!==receipt.couponId||discount.promotion_code||details.amount!==2900||refId(details.discount)!==discount.id)continue;
  if(line.amount!==2900||line.quantity!==1||(line.pricing?.price_details?.price??line.price?.id)!==prices.owner_op)continue;
  const {start,end}=line.period||{},paidAt=i.status_transitions?.paid_at;
  // One initial MONTHLY invoice period, never extended by visits or retries.
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start||end-start>32*86400||start>now/1000||end<=now/1000||!Number.isSafeInteger(paidAt)||paidAt<=0)continue;
  candidates.push({invoiceId:i.id,paidAt,plan:'plan_29',priceId:prices.owner_op,limit:1000,source:'academy',academyEndsAt:end});
 }
 if(candidates.length!==1)return fail();
 return candidates[0];
}
