// Input comes exclusively from Stripe server API. Never trust invoice/price IDs from a request.
export function paidPlanCredit(sub:any,invoices:any[],prices:{owner_op?:string;fleet?:string}){
 const customer=typeof sub.customer==='string'?sub.customer:sub.customer?.id;
 const candidates=[];
 for(const invoice of invoices){
  const ref=invoice.parent?.subscription_details?.subscription??invoice.subscription;
  if(invoice.livemode!==true||invoice.status!=='paid'||invoice.currency!=='usd'||!(invoice.amount_paid>0)||!/^in_[A-Za-z0-9]+$/.test(invoice.id||'')||(typeof ref==='string'?ref:ref?.id)!==sub.id||(typeof invoice.customer==='string'?invoice.customer:invoice.customer?.id)!==customer)continue;
  if(!['subscription_create','subscription_cycle','subscription_update'].includes(invoice.billing_reason)||invoice.lines?.has_more||!Array.isArray(invoice.lines?.data))continue;
  const lines=invoice.lines.data.filter((line:any)=>line.amount>0);
  if(lines.length!==1||lines[0].quantity!==1)continue;
  const line=lines[0],priceId=line.pricing?.price_details?.price??line.price?.id;
  const plan=priceId===prices.owner_op?'plan_29':priceId===prices.fleet?'plan_99':null;
  const paidAt=invoice.status_transitions?.paid_at;
  if(!plan||!Number.isSafeInteger(paidAt)||paidAt<=0)continue;
  // Return the paid price, not the current unpaid upgrade's price.
  candidates.push({invoiceId:invoice.id,paidAt,plan,priceId,limit:plan==='plan_29'?1000:2000});
 }
 candidates.sort((a,b)=>b.paidAt-a.paidAt);
 if(!candidates.length)throw Error('PAID_PLAN_CREDIT_REQUIRED');
 if(candidates.length>1&&candidates[0].paidAt===candidates[1].paidAt&&candidates[0].invoiceId!==candidates[1].invoiceId)throw Error('PAID_PLAN_CREDIT_AMBIGUOUS');
 return candidates[0];
}
