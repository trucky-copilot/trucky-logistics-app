import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveNativeBinding} from '../../base44/functions/linkBillingIdentity/binding.mjs';
function command(){const data=new Map();return async([op,script,count,forward,reverse,native,google])=>{
 assert.equal(op,'EVAL');assert.equal(count,'2');
 if((data.has(forward)&&data.get(forward)!==native)||(data.has(reverse)&&data.get(reverse)!==google))return 0;
 data.set(forward,native);data.set(reverse,google);return 1;
};}
test('concurrent different native users cannot bind the same Google subject',async()=>{
 const redis=command();const results=await Promise.allSettled([reserveNativeBinding(redis,'google','native_a'),reserveNativeBinding(redis,'google','native_b')]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected').length,1);
});
test('same identity retries retain the original binding',async()=>{
 const redis=command();await reserveNativeBinding(redis,'google','native_a');await reserveNativeBinding(redis,'google','native_a');
 await assert.rejects(reserveNativeBinding(redis,'google','native_b'),/ALREADY_BOUND/);
});
test('Redis failures never authorize a binding',async()=>{
 await assert.rejects(reserveNativeBinding(async()=>{throw Error('redis failed');},'google','native'));
});

test('one native user cannot be rebound to another Google identity',async()=>{
 const redis=command();await reserveNativeBinding(redis,'google_a','native');
 await assert.rejects(reserveNativeBinding(redis,'google_b','native'),/ALREADY_BOUND/);
 await reserveNativeBinding(redis,'google_a','native');
});
test('reject malformed identities before Redis',async()=>{
 await assert.rejects(reserveNativeBinding(async()=>{throw Error('called');},'google:injected','native'),/INVALID_IDENTITY/);
});
