import test from 'node:test';import assert from 'node:assert/strict';
import {verifiedScope} from '../../base44/functions/checkLiveCheckoutEligibility/verifiedScope.ts';
import {assertMembershipProvenance} from '../../base44/functions/checkLiveCheckoutEligibility/provenance.ts';
import {checkEligibility} from '../../base44/functions/checkLiveCheckoutEligibility/eligibility.ts';
import {redeemBillingLinkCore,HANDOFF_PREFIX} from '../../base44/functions/redeemBillingLink/redeem.ts';
import {reserveNativeBinding} from '../../base44/functions/redeemBillingLink/binding.ts';
import {registerNewEnrollment} from '../../base44/functions/createOrganizationForUser/enrollment.ts';
function world(){const store=new Map();const redis=async c=>{const [op,k,v]=c;if(op==='GET')return store.get(k)??null;if(op==='GETDEL'){const raw=store.get(k)??null;store.delete(k);return raw;}if(op==='EXISTS')return c.slice(1).filter(k=>store.has(k)).length;if(op==='EVAL'){if(String(c[1]).includes('MSET')){const[,,,pk,ek,p,e]=c;store.set(pk,p);store.set(ek,e);return 1;}const[,,,fwd,rev,native,google]=c;if((store.has(fwd)&&store.get(fwd)!==native)||(store.has(rev)&&store.get(rev)!==google))return 0;store.set(fwd,native);store.set(rev,google);return 1;}throw Error('unexpected');};return {store,redis};}
test('any new verified Google owner can register -> confirm native identity -> become eligible, no pilot IDs',async()=>{
 const w=world();
 for(let i=1;i<=4;i++){
  const m={id:`member_${i}`,organization_id:`org_${i}`,google_sub:`google_${i}`,role:'owner',active:true};const native=`native_${i}`;
  await registerNewEnrollment(w.redis,{id:m.organization_id},m);
  const find=async q=>Object.entries(q).every(([k,v])=>m[k]===v)?[m]:[];
  const scope=await verifiedScope(w.redis,find,assertMembershipProvenance,m.organization_id,m.google_sub);
  assert.equal(scope.memberIds.has(m.id),true);
  const code=String(i).repeat(64),hash=`hash_${i}`;w.store.set(HANDOFF_PREFIX+hash,JSON.stringify({sub:m.google_sub,orgId:m.organization_id,email:`owner${i}@example.invalid`}));
  const result=await redeemBillingLinkCore({code,confirm:true},{enabled:true,pilotOrgIds:scope.orgIds,pilotMemberIds:scope.memberIds,getUser:async()=>({id:native,email:`owner${i}@example.invalid`}),redis:w.redis,findMembers:find,updateMember:async(id,fields)=>Object.assign(m,fields),assertProvenance:assertMembershipProvenance,reserveBinding:reserveNativeBinding,sha256Hex:async()=>hash});
  assert.equal(result.code,'IDENTITY_LINKED');
  const eligibility=await checkEligibility(m.google_sub,m.organization_id,{enabled:true,syncEnabled:true,orgIds:scope.orgIds,memberIds:scope.memberIds,redis:w.redis,members:find,orgs:async()=>[{id:m.organization_id,active:true}],provenance:assertMembershipProvenance});
  assert.equal(eligibility.body.code,'LIVE_CHECKOUT_ELIGIBLE');
  const foreign=await verifiedScope(w.redis,find,assertMembershipProvenance,m.organization_id,'other_google');assert.equal(foreign.orgIds.size,0);
 }
});
test('previous phase-1 proven membership works without new registry; no legacy proof is minted',async()=>{
 const w=world(),m={id:'old_member',organization_id:'old_org',google_sub:'old_google',role:'owner',active:true};
 w.store.set('trucky:billing:member:v1:old_org:old_google',JSON.stringify({memberId:m.id,orgId:m.organization_id,googleSub:m.google_sub,role:m.role}));
 const original=[...w.store];const scope=await verifiedScope(w.redis,async()=>[m],assertMembershipProvenance,m.organization_id,m.google_sub);assert.equal(scope.memberIds.has(m.id),true);assert.deepEqual([...w.store],original);
});
test('unproven/changed/inactive/foreign membership never obtains general scope',async()=>{
 const w=world(),m={id:'member',organization_id:'org',google_sub:'google',role:'owner',active:true};
 await assert.rejects(verifiedScope(w.redis,async()=>[m],assertMembershipProvenance,'org','google'),/BILLING_ACCOUNT_REVIEW_REQUIRED/);
 for(const changed of [{...m,active:false},{...m,organization_id:'other'},{...m,role:'driver'},{...m,google_sub:'other'}])assert.equal((await verifiedScope(w.redis,async()=>[changed],assertMembershipProvenance,'org','google')).orgIds.size,0);
});
test('ambiguous canonical owner and Redis failure cannot authorize general subscription sync',async()=>{
 const rows=[{id:'a',organization_id:'org',google_sub:'google_a',role:'owner',active:true},{id:'b',organization_id:'org',google_sub:'google_b',role:'owner',active:true}];
 assert.equal((await verifiedScope(async()=>null,async()=>rows,async()=>{},'org')).orgIds.size,0);
 await assert.rejects(verifiedScope(async()=>{throw Error('network');},async()=>[rows[0]],async r=>{await r(['GET','key']);},'org'));
});
test('all packaged general scope implementations identical',async()=>{const{readFile}=await import('node:fs/promises');const names=['resolveUserOrganizations','checkLiveCheckoutEligibility','linkBillingIdentity','redeemBillingLink','syncBillingSubscription'];let first;for(const n of names){const s=await readFile(`base44/functions/${n}/verifiedScope.ts`,'utf8');first??=s;assert.equal(s,first);}});

test('subscription scope skips ONLY absent co-owner proof and preserves the proven owner',async()=>{
 const w=world(),proven={id:'verified',organization_id:'org',google_sub:'google',role:'owner',active:true},legacy={...proven,id:'legacy',google_sub:'legacy_google'};
 w.store.set('trucky:billing:member:v1:org:google',JSON.stringify({memberId:'verified',orgId:'org',googleSub:'google',role:'owner'}));
 const scope=await verifiedScope(w.redis,async()=>[legacy,proven],assertMembershipProvenance,'org');
 assert.deepEqual([...scope.memberIds],['verified']);
 const empty=await verifiedScope(w.redis,async()=>[legacy],assertMembershipProvenance,'org');assert.equal(empty.orgIds.size,0);
});
test('wrong or damaged co-owner proof and Redis failure block instead of silently skipping',async()=>{
 const m={id:'legacy',organization_id:'org',google_sub:'legacy_google',role:'owner',active:true};
 for(const raw of ['{bad json',JSON.stringify({memberId:'wrong',orgId:'org',googleSub:'legacy_google',role:'owner'})]){
  await assert.rejects(verifiedScope(async()=>raw,async()=>[m],assertMembershipProvenance,'org'));
 }
 await assert.rejects(verifiedScope(async()=>{throw Error('MEMBERSHIP_PROVENANCE_MISMATCH');},async()=>[m],assertMembershipProvenance,'org'));
});
