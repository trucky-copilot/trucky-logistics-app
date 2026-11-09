import {redeemBillingLinkCore,HANDOFF_PREFIX} from '../../base44/functions/redeemBillingLink/redeem.ts';
import {reserveNativeBinding} from '../../base44/functions/redeemBillingLink/binding.ts';
import {assertMembershipProvenance} from '../../base44/functions/redeemBillingLink/provenance.ts';
import {expandedScope} from '../../base44/functions/createOrganizationForUser/enrollment.ts';
import {checkEligibility} from '../../base44/functions/checkLiveCheckoutEligibility/eligibility.ts';
import test from 'node:test';import assert from 'node:assert/strict';import {enrollExisting} from '../../base44/functions/enrollExistingBillingOrganization/existing.ts';import {inspectCreation} from '../../base44/functions/inspectBillingCreation/inspect.ts';
function world(){const store=new Map(),m={id:'member',organization_id:'org',active:true,role:'owner',user_email:'owner@example.invalid'},o={id:'org',active:true,created_by_user:'owner@example.invalid'};let native={id:'native',email:'owner@example.invalid'},writes=0,now=1000000;const expiries=new Map();
 const redis=async c=>{const[op,k,v]=c;if(op==='GET'){if(expiries.has(k)&&expiries.get(k)<=now){store.delete(k);expiries.delete(k);}return store.get(k)??null;}if(op==='GETDEL'){const x=store.get(k)??null;store.delete(k);return x;}if(op==='SET'){if(c.includes('NX')&&store.has(k))return null;store.set(k,v);const ex=c.indexOf('EX');if(ex!==-1)expiries.set(k,now+Number(c[ex+1])*1000);return 'OK';}if(op==='EXISTS')return c.slice(1).filter(k=>store.has(k)).length;if(op==='EVAL'){if(String(c[1]).includes("redis.call('SET',KEYS[1],ARGV[1])")){const[,,,fwd,rev,native,google]=c;if((store.has(fwd)&&store.get(fwd)!==native)||(store.has(rev)&&store.get(rev)!==google))return 0;store.set(fwd,native);store.set(rev,google);return 1;}if(String(c[1]).includes('MSET')){const[,,,p,e,pv,ev]=c;const oldp=store.get(p),olde=store.get(e);for(const [old,wanted] of [[oldp,pv],[olde,ev]]){if(old){const x=JSON.parse(old),y=JSON.parse(wanted);if(Object.keys(y).some(k=>x[k]!==y[k]))return 0;}}if(olde&&!oldp)return 0;store.set(p,pv);store.set(e,ev);return 1;}const[,,,a,au,raw,event]=c;if(store.get(a)!==raw)return 0;store.set(au,event);store.delete(a);return 1;}throw Error('unexpected');};
 const d={enabled:true,adminIds:new Set(['admin']),trustedServer:async()=>true,native:async()=>native,google:async()=>({sub:'google',email:'owner@example.invalid',email_verified:true,iat:1000}),redis,now:()=>now,id:()=> 'approval',member:async()=>m,org:async()=>o,owners:async()=>[m],updateMember:async(q,f)=>{assert.equal(q.id,'member');writes++;Object.assign(m,f);return {updated:1};}};
 return{d,m,store,writes:()=>writes,setNative:v=>native=v,advance:ms=>now+=ms};}
const target={organization_id:'org',member_id:'member'};
async function approve(w){assert.equal((await enrollExisting({...target,mode:'owner_approval',google_id_token:'fixture',owner_consent:true},w.d)).body.code,'EXISTING_GOOGLE_APPROVAL_RECORDED');assert.equal((await enrollExisting({...target,mode:'request',request_id:'approval',owner_consent:true},w.d)).body.code,'EXISTING_OWNER_APPROVAL_RECORDED');}
test('two authenticated consents alone never enroll: reviewed admin executes exact existing pair',async()=>{const w=world();await approve(w);assert.equal(w.writes(),0);const input={...target,request_id:'approval',mode:'preview'};assert.equal((await enrollExisting(input,w.d)).status,403);w.setNative({id:'admin',role:'admin'});assert.equal((await enrollExisting(input,w.d)).body.code,'EXISTING_ENROLLMENT_READY');assert.equal((await enrollExisting({...input,mode:'execute',confirm:'ENROLL member',ownership_verified:true,evidence_reference:'case-verified-001'},w.d)).body.code,'EXISTING_ENROLLMENT_RECORDED');assert.equal(w.m.google_sub,'google');assert.equal(w.writes(),1);assert.equal(JSON.parse(w.store.get('trucky:billing:enrollment:v1:org:org')).memberId,'member');assert.equal((await enrollExisting({...input,mode:'execute'},w.d)).body.code,'OWNER_APPROVAL_REQUIRED');});
test('wrong native identity, false consent or wrong server never records approval',async()=>{const w=world();let r=await enrollExisting({...target,mode:'owner_approval',google_id_token:'x',owner_consent:true},{...w.d,trustedServer:async()=>false});assert.equal(r.status,401);r=await enrollExisting({...target,mode:'owner_approval',google_id_token:'x',owner_consent:false},w.d);assert.equal(r.status,400);await enrollExisting({...target,mode:'owner_approval',google_id_token:'x',owner_consent:true},w.d);w.setNative({id:'intruder',email:'other@example.invalid'});assert.equal((await enrollExisting({...target,mode:'request',request_id:'approval',owner_consent:true},w.d)).body.code,'IDENTITY_MISMATCH');assert.equal(w.writes(),0);});
test('admin cannot overwrite existing subject/native or skip independent evidence',async()=>{const w=world();await approve(w);w.setNative({id:'admin',role:'admin'});assert.equal((await enrollExisting({...target,mode:'execute',request_id:'approval',confirm:'ENROLL member',ownership_verified:true},w.d)).body.code,'ADMIN_REVIEW_REQUIRED');w.m.google_sub='other';assert.equal((await enrollExisting({...target,mode:'preview',request_id:'approval'},w.d)).body.code,'IDENTITY_CONFLICT');assert.equal(w.writes(),0);});
test('inspection is read only and reports uncertainty rather than deleting lock',async()=>{const w=world(),commands=[];const r=await inspectCreation({google_sub:'google',company_name:'Company'},{enabled:true,adminIds:new Set(['admin']),user:async()=>({id:'admin',role:'admin'}),redis:async c=>{commands.push(c);return 'pending-owner';},members:async()=>[w.m],orgs:async()=>[{...w.d.org(),id:'org',name:'Company'}]});assert.equal(r.body.code,'CREATION_INSPECTED');assert.equal(r.body.no_automatic_release,true);assert.equal(r.body.may_have_unfinished_write,true);assert.ok(commands.every(c=>c[0]==='GET'));});

test('existing conflicting global binding prevents admin membership rewrite',async()=>{const w=world();await approve(w);w.setNative({id:'admin',role:'admin'});w.store.set('trucky:billing:identity:v1:google','other-native');const r=await enrollExisting({...target,mode:'preview',request_id:'approval'},w.d);assert.equal(r.body.code,'IDENTITY_CONFLICT');assert.equal(w.writes(),0);});
test('admin 15-minute window starts at native confirmation, not earlier Google approval',async()=>{
 const w=world();await enrollExisting({...target,mode:'owner_approval',google_id_token:'fixture',owner_consent:true},w.d);
 w.advance(9*60000);
 const native=await enrollExisting({...target,mode:'request',request_id:'approval',owner_consent:true},w.d);
 assert.equal(native.body.code,'EXISTING_OWNER_APPROVAL_RECORDED');
 assert.equal(Date.parse(native.body.expires_at),1000000+24*60000);
 w.setNative({id:'admin',role:'admin'});w.advance(10*60000);
 assert.equal((await enrollExisting({...target,mode:'preview',request_id:'approval'},w.d)).body.code,'EXISTING_ENROLLMENT_READY');
 w.advance(5*60000);
 assert.equal((await enrollExisting({...target,mode:'preview',request_id:'approval'},w.d)).body.code,'OWNER_APPROVAL_REQUIRED');
});
test('native session absent/rejected returns 401 without consuming owner approval',async()=>{
 const w=world();await enrollExisting({...target,mode:'owner_approval',google_id_token:'fixture',owner_consent:true},w.d);
 for(const native of [async()=>null,async()=>{throw Error('not authorized');}]){
  const r=await enrollExisting({...target,mode:'request',request_id:'approval',owner_consent:true},{...w.d,native});assert.equal(r.status,401);assert.equal(r.body.code,'NATIVE_SESSION_REQUIRED');
 }
 assert.equal(w.store.has('trucky:billing:existing:v1:owner:approval'),true);
});
for(const prior of [false,true])test(`execute -> ordinary redeem -> live eligibility with prior phase-1 proof=${prior}`,async()=>{
 const w=world();if(prior){w.m.google_sub='google';w.m.base44_user_id='native';w.store.set('trucky:billing:member:v1:org:google',JSON.stringify({memberId:'member',orgId:'org',googleSub:'google',role:'owner'}));}
 await approve(w);w.setNative({id:'admin',role:'admin'});
 const r=await enrollExisting({...target,mode:'execute',request_id:'approval',confirm:'ENROLL member',ownership_verified:true,evidence_reference:'operator-history-001'},w.d);
 assert.equal(r.body.code,'EXISTING_ENROLLMENT_RECORDED');
 const scope=await expandedScope(w.d.redis,'org',false,new Set(),new Set(),'google');
 w.store.set(HANDOFF_PREFIX+'hash',JSON.stringify({orgId:'org',sub:'google',email:'owner@example.invalid'}));
 const linked=await redeemBillingLinkCore({code:'a'.repeat(64),confirm:true},{enabled:true,pilotOrgIds:scope.orgIds,pilotMemberIds:scope.memberIds,getUser:async()=>({id:'native',email:'owner@example.invalid'}),redis:w.d.redis,findMembers:async()=>[w.m],updateMember:async()=>assert.fail('already linked: no update needed'),assertProvenance:assertMembershipProvenance,reserveBinding:reserveNativeBinding,sha256Hex:async()=> 'hash'});
 assert.equal(linked.code,'IDENTITY_LINKED');
 const eligible=await checkEligibility('google','org',{enabled:true,syncEnabled:true,orgIds:scope.orgIds,memberIds:scope.memberIds,redis:w.d.redis,members:async()=>[w.m],orgs:async()=>[{id:'org',active:true}],provenance:assertMembershipProvenance});
 assert.equal(eligible.body.code,'LIVE_CHECKOUT_ELIGIBLE');
});
test('reviewed enrollment must not overwrite conflicting old proof',async()=>{
 const w=world();await approve(w);w.setNative({id:'admin',role:'admin'});w.store.set('trucky:billing:member:v1:org:google',JSON.stringify({memberId:'someone-else',orgId:'org',googleSub:'google',role:'owner'}));
 const r=await enrollExisting({...target,mode:'execute',request_id:'approval',confirm:'ENROLL member',ownership_verified:true,evidence_reference:'operator-history-001'},w.d);
 assert.equal(r.body.code,'EXISTING_ENROLLMENT_REQUIRES_REVIEW');assert.equal(w.store.has('trucky:billing:enrollment:v1:org:org'),false);assert.equal(JSON.parse(w.store.get('trucky:billing:member:v1:org:google')).memberId,'someone-else');
});
test('completed creation is not reported as unfinished; inspector only reads',async()=>{
 const w=world();const r=await inspectCreation({google_sub:'google',company_name:'Company'},{enabled:true,adminIds:new Set(['admin']),user:async()=>({id:'admin',role:'admin'}),redis:async c=>{assert.equal(c[0],'GET');return 'org';},members:async()=>[w.m],orgs:async()=>[{id:'org',name:'Company',active:true}]});
 assert.equal(r.body.reservation_completed,true);assert.equal(r.body.may_have_unfinished_write,false);
});
