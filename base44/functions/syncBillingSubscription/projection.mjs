const STATUSES=new Set(['trialing','active','past_due','canceled','unpaid','incomplete','incomplete_expired','paused']);
export function subscriptionProjection(org,sub,mode){
 if(!['test','live'].includes(mode))throw Error('INVALID_MODE');
 const live=mode==='live';
 if(sub.livemode!==live||sub.metadata?.org_id!==org.id)throw Error('SUBSCRIPTION_MISMATCH');
 if(!STATUSES.has(sub.status))throw Error('STATUS_REQUIRES_MIGRATION');
 const customer=typeof sub.customer==='string'?sub.customer:sub.customer?.id;
 if(!customer)throw Error('CUSTOMER_REQUIRED');
 const prefix=live?'stripe_live_':'stripe_';
 if((org[prefix+'subscription_id']&&org[prefix+'subscription_id']!==sub.id)||(org[prefix+'customer_id']&&org[prefix+'customer_id']!==customer))throw Error('BILLING_MAPPING_CONFLICT');
 return {
  [live?'live_subscription_status':'subscription_status']:sub.status,
  [prefix+'subscription_id']:sub.id,[prefix+'customer_id']:customer,
  [live?'live_trial_ends_at':'trial_ends_at']:sub.trial_end?new Date(sub.trial_end*1000).toISOString():null,
 };
}
