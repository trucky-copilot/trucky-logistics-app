export function liveBillingDecision(subscription, orgId, expectedCustomer) {
 if (!subscription || subscription.livemode !== true || subscription.metadata?.org_id !== orgId) return {allowed:false,reason:'SUBSCRIPTION_MISMATCH'};
 const customer=typeof subscription.customer==='string'?subscription.customer:subscription.customer?.id;
 if (!expectedCustomer || customer!==expectedCustomer) return {allowed:false,reason:'CUSTOMER_MISMATCH'};
 if (subscription.status!=='active') return {allowed:false,reason:'SUBSCRIPTION_NOT_ACTIVE',status:subscription.status};
 return {allowed:true,reason:'ACTIVE',status:'active'};
}
