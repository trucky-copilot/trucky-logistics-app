import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedLivePlan} from '../../base44/functions/syncBillingSubscription/live-plan.mjs';
const price={id:'price_fixture',livemode:true,currency:'usd',type:'recurring',billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1},unit_amount:2900};
const sub={status:'active',trial_end:null,items:{data:[{quantity:1,price}]}};
test('recognizes 29 and 99 monthly real plans',()=>{
 assert.equal(verifiedLivePlan(sub).live_plan_code,'owner_op');
 assert.equal(verifiedLivePlan({...sub,items:{data:[{quantity:1,price:{...price,unit_amount:9900}}]}}).live_plan_code,'fleet');
});
test('rejects free trial and unrecognized/multi-seat/cross-mode prices',()=>{
 assert.throws(()=>verifiedLivePlan({...sub,status:'trialing'}),/TRIAL/);
 assert.throws(()=>verifiedLivePlan({...sub,trial_end:123}),/TRIAL/);
 for(const changed of [{livemode:false},{unit_amount:1000},{currency:'eur'},{recurring:{interval:'year',interval_count:1}}])assert.throws(()=>verifiedLivePlan({...sub,items:{data:[{quantity:1,price:{...price,...changed}}]}}),/MISMATCH/);
 assert.throws(()=>verifiedLivePlan({...sub,items:{data:[{quantity:2,price}]}}),/MISMATCH/);
});
