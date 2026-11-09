export function readBillingMode(value:unknown,liveEnabled:boolean){
 if(value!==undefined&&value!=='test'&&value!=='live')return {mode:'test',status:400,code:'INVALID_MODE'} as const;
 if(value==='live'&&!liveEnabled)return {mode:'live',status:503,code:'LIVE_CHECKOUT_NOT_READY'} as const;
 return {mode:value==='live'?'live':'test',status:200,code:'OK'} as const;
}
export function organizationBillingView(org:Record<string,any>,live:boolean){
 const liveEmpty=!org.stripe_live_subscription_id&&!org.stripe_live_customer_id&&!org.stripe_live_price_id&&!org.stripe_live_sync_operation_id&&!org.stripe_live_subscription_status&&!org.stripe_live_plan_type;
 const status=live?(org.stripe_live_subscription_status??(liveEmpty?'none':'requires_review')):(org.subscription_status??'none');
 return {subscription_status:status,plan_type:live?(org.stripe_live_plan_type??'none'):(org.plan_type??'none'),can_checkout:live?liveEmpty:!new Set(['trialing','active','past_due']).has(status)};
}
