import test from 'node:test';import assert from 'node:assert/strict';
import {checkEligibility} from '../../base44/functions/checkLiveCheckoutEligibility/eligibility.ts';
import {reconcileLiveSubscription} from '../../base44/functions/syncBillingSubscription/live.ts';
import {autoLinkPublicAccount,AUTO_BIND_PUBLIC} from '../../base44/shared/autoLinkPublicAccount.ts';
import {publicLandingAccount} from '../../base44/shared/publicLandingAccount.ts';
import {assertMembershipProvenance} from '../../base44/functions/syncBillingSubscription/provenance.ts';
import {resolveLivePlan} from '../../base44/shared/livePlanPolicy.ts';
import {createRedisMock} from './_liveSyncRedisMock.ts';
const email='new@example.invalid';
function world({origin='landing_public_new'}={}){
 const org={id:'org',name:'Cuenta New',active:true,created_by_user:email};
 const m={id:'member',organization_id:'org',google_sub:'google',user_email:email,role:'owner',active:true};
 const user={id:'native',email,is_verified:true};let writes=0;
 const proof=JSON.stringify({orgId:'org',memberId:'member',googleSub:'google',role:'owner'});
 const entry=JSON.stringify({version:1,orgId:'org',memberId:'member',googleSub:'google',role:'owner',...(origin?{origin}:{})});
 const mock=createRedisMock([['trucky:billing:member:v1:org:google',proof],['trucky:billing:enrollment:v1:org:org',entry]]),store=mock.store;
 const redis=async c=>{
  if(c[0]==='EXISTS')return c.slice(1).filter(k=>store.has(k)).length;
  if(c[0]==='EVAL'&&c[1]===AUTO_BIND_PUBLIC){const keys=c.slice(3,9),a=c.slice(9);if(store.get(keys[2])!==a[2]||store.get(keys[3])!==a[3]||store.get(keys[5])!==a[5])return -1;if(store.has(keys[0])&&store.get(keys[0])!==a[0]||store.has(keys[1])&&store.get(keys[1])!==a[1])return 0;store.set(keys[0],a[0]);store.set(keys[1],a[1]);return 1;}
  return mock.cmd(c);
 };
 const matches=(row,q)=>Object.entries(q).every(([k,v])=>v&&typeof v==='object'&&'$exists'in v?Object.hasOwn(row,k)===v.$exists:row[k]===v);
 const members=async q=>matches(m,q)?[structuredClone(m)]:[];
 const orgs=async q=>matches(org,q)?[structuredClone(org)]:[];
 const update=async(q,f)=>{if(!matches(m,q))return {updated:0};writes++;Object.assign(m,f);return {updated:1};};
 const auto={redis,members,orgs,update};
 const price={id:'price_owner',livemode:true,currency:'usd',unit_amount:2900,type:'recurring',recurring:{interval:'month',interval_count:1},billing_scheme:'per_unit'};
 const sub={id:'sub_real',customer:'cus_real',metadata:{org_id:'org'},livemode:true,status:'active',items:{data:[{quantity:1,price}]},latest_invoice:{status:'paid',livemode:true,billing_reason:'subscription_create',customer:'cus_real',subscription:'sub_real'}};
 const eligibility={enabled:true,syncEnabled:true,orgIds:new Set(['org']),memberIds:new Set(['member']),redis,members,orgs:async id=>orgs({id}),provenance:assertMembershipProvenance};
 const sync={enabled:true,orgIds:new Set(['org']),memberIds:new Set(['member']),prices:{owner_op:'price_owner',fleet:'price_fleet'},redis,members,organizations:async id=>orgs({id}),assertProvenance:assertMembershipProvenance,owner:()=>crypto.randomUUID(),retrieve:async()=>sub,update:async(_id,f)=>{Object.assign(org,f);return {updated:1};}};
 return{org,m,user,auto,redis,store,members,orgs,sub,eligibility,sync,writes:()=>writes};
}
test('new account → eligible before native link → webhook stores live subscription → first verified login → active paid plan',async()=>{
 const w=world();assert.equal((await checkEligibility('google','org',w.eligibility)).body.code,'LIVE_CHECKOUT_ELIGIBLE');assert.equal(w.m.base44_user_id,undefined);
 assert.equal((await reconcileLiveSubscription({mode:'live',organization_id:'org',subscription_id:'sub_real'},w.sync)).body.code,'SUBSCRIPTION_RECONCILED');assert.equal(w.org.stripe_live_subscription_status,'active');assert.equal(w.m.base44_user_id,undefined);
 assert.equal((await autoLinkPublicAccount(w.user,w.auto)).code,'IDENTITY_LINKED');assert.equal(w.m.base44_user_id,'native');assert.equal(w.store.get('trucky:billing:native:v1:native'),'google');assert.equal(w.store.get('trucky:billing:identity:v1:google'),'native');
 const access=await resolveLivePlan(w.user,{enabled:true,prices:w.sync.prices,redis:w.redis,members:w.members,orgs:async id=>w.orgs({id}),subscription:async()=>w.sub});assert.equal(access.allowed,true);assert.equal(access.plan,'plan_29');
 await autoLinkPublicAccount(w.user,w.auto);assert.equal(w.writes(),1);assert.equal((await checkEligibility('google','org',w.eligibility)).body.code,'ALREADY_SUBSCRIBED');
});
test('wrong native email, unverified, disabled and service session cannot auto-link',async()=>{for(const override of [{email:'other@example.invalid'},{is_verified:false},{is_verified:'true'},{disabled:true},{is_service:true}]){const w=world();assert.equal((await autoLinkPublicAccount({...w.user,...override},w.auto)).linked,false);assert.equal(w.writes(),0);assert.equal(w.store.has('trucky:billing:native:v1:native'),false);}});
test('legacy and admin-reviewed existing organization still requires explicit identity and never auto-links',async()=>{for(const origin of [null,'reviewed_existing']){const w=world({origin});assert.equal((await autoLinkPublicAccount(w.user,w.auto)).linked,false);assert.equal((await checkEligibility('google','org',w.eligibility)).body.code,'LIVE_IDENTITY_LINK_REQUIRED');assert.equal((await reconcileLiveSubscription({mode:'live',organization_id:'org',subscription_id:'sub_real'},w.sync)).body.code,'IDENTITY_NOT_LINKED');assert.equal(w.org.stripe_live_subscription_id,undefined);}});
test('new native session with foreign binding, changed member or multiple memberships fails closed',async()=>{const w=world();w.store.set('trucky:billing:native:v1:native','other');await assert.rejects(autoLinkPublicAccount(w.user,w.auto),/CONFLICT/);assert.equal(w.writes(),0);
 const x=world();const all=x.auto.members;x.auto.members=async q=>q.user_email?[x.m,{...x.m,id:'another'}]:all(q);assert.equal((await autoLinkPublicAccount(x.user,x.auto)).linked,false);
 const y=world();y.m.base44_user_id='other';assert.equal((await autoLinkPublicAccount(y.user,y.auto)).code,'IDENTITY_ALREADY_BOUND');});
test('conditional write failure keeps reserved binding; same session recovers without another company or overwritten identity',async()=>{const w=world();const original=w.auto.update;w.auto.update=async()=>{throw Error('db timeout');};await assert.rejects(autoLinkPublicAccount(w.user,w.auto));assert.equal(w.m.base44_user_id,undefined);assert.equal(w.store.get('trucky:billing:native:v1:native'),'google');w.auto.update=original;assert.equal((await autoLinkPublicAccount(w.user,w.auto)).linked,true);assert.equal(w.writes(),1);});
test('co-owner, pending lock, mismatched provenance and existing live subscription prevent checkout',async()=>{const w=world();const members=w.eligibility.members;w.eligibility.members=async q=>q.role==='owner'?[w.m,{...w.m,id:'other'}]:members(q);assert.notEqual((await checkEligibility('google','org',w.eligibility)).status,200);
 const x=world();x.store.set('trucky:billing:sync:live:pending:org:org','pending');assert.equal((await checkEligibility('google','org',x.eligibility)).body.code,'LIVE_RECONCILIATION_PENDING');
 const y=world();y.store.set('trucky:billing:member:v1:org:google','{}');assert.notEqual((await checkEligibility('google','org',y.eligibility)).status,200);
 const z=world();z.org.stripe_live_subscription_id='sub_old';assert.equal((await checkEligibility('google','org',z.eligibility)).body.code,'ALREADY_SUBSCRIBED');});
test('historical public landing account requires finalized server creation receipt; pending or missing receipt never adopts',async()=>{const w=world({origin:null});const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('google:cuenta new'));const hash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');const key=`trucky:billing:create:v1:attempt:${hash}`;
 assert.equal(await publicLandingAccount(w.redis,w.org,w.m,w.members),false);w.store.set(key,'pending');assert.equal(await publicLandingAccount(w.redis,w.org,w.m,w.members),false);w.store.set(key,'org');assert.equal(await publicLandingAccount(w.redis,w.org,w.m,w.members),true);assert.equal((await autoLinkPublicAccount(w.user,w.auto)).linked,true);
});
test('concurrent distinct native users with same verified email cannot both bind',async()=>{const w=world();const results=await Promise.allSettled([autoLinkPublicAccount(w.user,w.auto),autoLinkPublicAccount({...w.user,id:'native_two'},w.auto)]);assert.equal(results.filter(x=>x.status==='fulfilled'&&x.value.linked).length,1);assert.ok(['native','native_two'].includes(w.m.base44_user_id));assert.equal(w.store.get('trucky:billing:identity:v1:google'),w.m.base44_user_id);assert.equal(w.store.get(`trucky:billing:native:v1:${w.m.base44_user_id}`),'google');});
test('Redis loss, enrollment mismatch and concurrent DB identity replacement never overwrite member',async()=>{const w=world();w.auto.redis=async()=>{throw Error('redis unavailable');};await assert.rejects(autoLinkPublicAccount(w.user,w.auto));assert.equal(w.writes(),0);
 const x=world();x.store.set('trucky:billing:enrollment:v1:org:org',JSON.stringify({version:1,orgId:'org',memberId:'foreign',googleSub:'google',role:'owner',origin:'landing_public_new'}));await assert.rejects(autoLinkPublicAccount(x.user,x.auto));assert.equal(x.writes(),0);
 const y=world();const update=y.auto.update;y.auto.update=async(q,f)=>{y.m.base44_user_id='different';return update(q,f);};await assert.rejects(autoLinkPublicAccount(y.user,y.auto),/PENDING/);assert.equal(y.m.base44_user_id,'different');assert.equal(y.writes(),0);
});
