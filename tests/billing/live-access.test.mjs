import test from 'node:test';
import assert from 'node:assert/strict';
import {liveBillingDecision} from '../../base44/functions/getLiveBillingAccess/policy.mjs';
const sub={livemode:true,status:'active',metadata:{org_id:'org'},customer:'cus_live'};
test('active live subscription accepted only for matching org/customer',()=>{assert.equal(liveBillingDecision(sub,'org','cus_live').allowed,true);assert.equal(liveBillingDecision(sub,'other','cus_live').allowed,false);assert.equal(liveBillingDecision(sub,'org','other').allowed,false);});
test('test and unpaid states cannot grant live access',()=>{assert.equal(liveBillingDecision({...sub,livemode:false},'org','cus_live').allowed,false);for(const status of ['trialing','incomplete','past_due','canceled','unpaid','paused'])assert.equal(liveBillingDecision({...sub,status},'org','cus_live').allowed,false);});
