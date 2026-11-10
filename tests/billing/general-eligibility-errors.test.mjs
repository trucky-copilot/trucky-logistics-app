import test from 'node:test';import assert from 'node:assert/strict';
import {eligibilityHttp} from '../../base44/functions/checkLiveCheckoutEligibility/http.ts';
const req=()=>new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({google_sub:'subject',organization_id:'org'})});
test('own membership lacking server proof returns explicit review path, not generic infrastructure error',async()=>{
 const r=await eligibilityHttp(req(),{secret:'fixture',enabled:true,syncEnabled:true,makeDeps:async()=>{throw Error('BILLING_ACCOUNT_REVIEW_REQUIRED');}});
 assert.equal(r.status,409);assert.equal((await r.json()).code,'BILLING_ACCOUNT_REVIEW_REQUIRED');
});
test('mismatch/network failures still return fail-closed 503',async()=>{
 for(const message of ['MEMBERSHIP_PROVENANCE_MISMATCH','REDIS_UNAVAILABLE']){
  const r=await eligibilityHttp(req(),{secret:'fixture',enabled:true,syncEnabled:true,makeDeps:async()=>{throw Error(message);}});
  assert.equal(r.status,503);assert.equal((await r.json()).code,'LIVE_CHECKOUT_REQUIRES_REVIEW');
 }
});
