import test from 'node:test';
import assert from 'node:assert/strict';
import {assertMembershipProvenance,provenanceKey} from '../../base44/functions/linkBillingIdentity/provenance.mjs';
const member={id:'member_a',organization_id:'org',google_sub:'google',role:'owner'};
const proof={memberId:'member_a',orgId:'org',googleSub:'google',role:'owner'};
test('client row without server proof is rejected',async()=>{await assert.rejects(assertMembershipProvenance(async()=>null,member),/REQUIRED/);});
test('proof is bound to exact membership identity and role',async()=>{
 const read=async()=>JSON.stringify(proof);await assertMembershipProvenance(read,member);
 for(const changed of [{id:'forged'},{role:'admin'},{organization_id:'other'},{google_sub:'other'}])await assert.rejects(assertMembershipProvenance(read,{...member,...changed}),/MISMATCH/);
});
test('malformed IDs and Redis failures fail closed',async()=>{
 assert.throws(()=>provenanceKey('org:injected','google'),/INVALID/);
 await assert.rejects(assertMembershipProvenance(async()=>{throw Error('Redis unavailable');},member));
});
