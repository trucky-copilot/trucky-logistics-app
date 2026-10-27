import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedLivePlan} from '../../base44/functions/syncBillingSubscription/live-plan.mjs';
const price={id:'price_29',livemode:true,currency:'usd',type:'recurring',billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1},unit_amount:2900};
const allowed={owner_op:'price_29',fleet:'price_99'};
const verify=(subscription)=>verifiedLivePlan(subscription,allowed);
const sub={status:'active',trial_end:null,items:{data:[{quantity:1,price}]}};
test('recognizes 29 and 99 monthly real plans',()=>{
 assert.equal(verify(sub).live_plan_code,'owner_op');
 assert.equal(verify({...sub,items:{data:[{quantity:1,price:{...price,id:'price_99',unit_amount:9900}}]}}).live_plan_code,'fleet');
});
test('rejects free trial and unrecognized/multi-seat/cross-mode prices',()=>{
 assert.throws(()=>verify({...sub,status:'trialing'}),/TRIAL/);
 assert.throws(()=>verify({...sub,trial_end:123}),/TRIAL/);
 for(const changed of [{livemode:false},{unit_amount:1000},{currency:'eur'},{recurring:{interval:'year',interval_count:1}}])assert.throws(()=>verify({...sub,items:{data:[{quantity:1,price:{...price,...changed}}]}}),/MISMATCH/);
 assert.throws(()=>verify({...sub,items:{data:[{quantity:2,price}]}}),/MISMATCH/);
});

test('matching amount with unapproved price ID never grants access',()=>{
 assert.throws(()=>verify({...sub,items:{data:[{quantity:1,price:{...price,id:'price_unauthorized'}}]}}),/MISMATCH/);
 assert.throws(()=>verifiedLivePlan(sub,{}),/NOT_CONFIGURED/);
 assert.throws(()=>verifiedLivePlan(sub,{owner_op:'price_29',fleet:'price_29'}),/NOT_CONFIGURED/);
});
