export function verifiedLivePlan(subscription) {
 const items=subscription.items?.data;
 if(!Array.isArray(items)||items.length!==1||items[0].quantity!==1)throw Error('LIVE_PLAN_MISMATCH');
 const price=items[0].price;
 if(!price?.livemode||price.currency!=='usd'||price.type!=='recurring'||price.billing_scheme!=='per_unit'||price.recurring?.interval!=='month'||price.recurring.interval_count!==1)throw Error('LIVE_PLAN_MISMATCH');
 if(subscription.status==='trialing'||subscription.trial_end)throw Error('PAID_PLAN_TRIAL_NOT_ALLOWED');
 const plan=price.unit_amount===2900?'owner_op':price.unit_amount===9900?'fleet':null;
 if(!plan)throw Error('LIVE_PLAN_MISMATCH');
 return {stripe_live_price_id:price.id,live_plan_code:plan};
}
