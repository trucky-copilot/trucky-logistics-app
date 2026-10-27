import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveNativeBinding} from '../../base44/functions/linkBillingIdentity/binding.mjs';
function command(){const data=new Map();return async([op,key,value])=>{if(op==='SET'){if(data.has(key))return null;data.set(key,value);return 'OK';}return data.get(key)??null;};}
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
