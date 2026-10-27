import test from 'node:test';
import assert from 'node:assert/strict';
import {subscriptionProjection} from '../../base44/functions/syncBillingSubscription/projection.mjs';
const org={id:'org',stripe_subscription_id:'sub_test',stripe_customer_id:'cus_test',subscription_status:'trialing'};
const live={id:'sub_live',customer:'cus_live',livemode:true,status:'active',metadata:{org_id:'org'},trial_end:null};
test('live projection never modifies test fields or org identity',()=>{
 const result=subscriptionProjection(org,live,'live');
 assert.deepEqual(result,{live_subscription_status:'active',stripe_live_subscription_id:'sub_live',stripe_live_customer_id:'cus_live',live_trial_ends_at:null});
 assert.equal(org.subscription_status,'trialing');
});
test('reject mismatched tenant/mode/customer/subscription',()=>{
 assert.throws(()=>subscriptionProjection(org,live,'test'),/MISMATCH/);
 assert.throws(()=>subscriptionProjection({...org,id:'other'},live,'live'),/MISMATCH/);
 assert.throws(()=>subscriptionProjection({...org,stripe_live_customer_id:'other'},live,'live'),/CONFLICT/);
 assert.throws(()=>subscriptionProjection({...org,stripe_live_subscription_id:'other'},live,'live'),/CONFLICT/);
});
test('canceled/unpaid/expired states remain truthful, never active fallback',()=>{
 for(const status of ['canceled','unpaid','past_due','incomplete_expired','paused']) assert.equal(subscriptionProjection(org,{...live,status},'live').live_subscription_status,status);
 assert.throws(()=>subscriptionProjection(org,{...live,status:'unknown'},'live'),/MIGRATION/);
});
