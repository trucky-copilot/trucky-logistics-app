import test from 'node:test';import assert from 'node:assert/strict';
import {probeUpdateMany} from '../../base44/functions/probeMembershipUpdateMany/probe.ts';
import {updateOne} from './_mongoLike.mjs';
function world(over={},opts={}){
 const rec={id:'tm',organization_id:'torg',role:'owner',active:true,google_sub:'gsub-secret-value'};let writes=0;const store=new Map();
 const d={enabled:true,adminIds:new Set(['admin']),memberId:'tm',orgId:'torg',pilotOrgIds:new Set(['pilot_org']),pilotMemberIds:new Set(['pilot_member']),
  user:async()=>({id:'admin',role:'admin'}),read:async id=>id==='tm'?structuredClone(rec):null,
  updateMany:async(q,data)=>{if(opts.throwAt!==undefined&&writes===opts.throwAt){writes++;throw Error('provider');}writes++;return updateOne(rec,q,data,opts);},
  redis:async([op,k])=>store.get(k)??null,runId:()=>'abc123',...over};
 return {rec,d,store,writes:()=>writes};
}
const ok={confirm:'PROBE tm'};
test('probe passes with MongoDB semantics, restores absent base44_user_id and never writes google_sub',async()=>{
 const w=world();const r=await probeUpdateMany(ok,w.d);
 assert.equal(r.body.code,'PROBE_PASSED',JSON.stringify(r.body));
 assert.equal(r.body.restored,true);assert.equal(r.body.googleSubUnchanged,true);assert.equal(r.body.idempotentByVerifiedRead,true);
 assert.equal(r.body.nullStoredAs,'null');assert.equal(r.body.existsFalseMatchesNull,false);
 assert.equal(Object.hasOwn(w.rec,'base44_user_id'),false);assert.equal(w.rec.google_sub,'gsub-secret-value');
 assert.equal(JSON.stringify(r.body).includes('gsub-secret-value'),false);
});
test('guards: disabled, non-admin, unconfigured, wrong confirmation, pilot or enrolled target → no write',async()=>{
 const cases=[[{enabled:false},'PROBE_DISABLED'],[{user:async()=>null},'ADMIN_SESSION_REQUIRED'],[{user:async()=>({id:'u',role:'user'})},'ADMIN_NOT_AUTHORIZED'],
  [{user:async()=>({id:'admin2',role:'admin'})},'ADMIN_NOT_AUTHORIZED'],[{memberId:undefined},'PROBE_TARGET_NOT_CONFIGURED'],
  [{pilotMemberIds:new Set(['tm'])},'PILOT_TARGET_REFUSED'],[{pilotOrgIds:new Set(['torg'])},'PILOT_TARGET_REFUSED']];
 for(const [over,code] of cases){const w=world(over);assert.equal((await probeUpdateMany(ok,w.d)).body.code,code);assert.equal(w.writes(),0);}
 const w=world();assert.equal((await probeUpdateMany({confirm:'PROBE other'},w.d)).body.code,'CONFIRMATION_REQUIRED');assert.equal(w.writes(),0);
 const e=world();e.store.set('trucky:billing:enrollment:v1:org:torg','{}');assert.equal((await probeUpdateMany(ok,e.d)).body.code,'ENROLLED_TARGET_REFUSED');assert.equal(e.writes(),0);
 const p=world();p.rec.base44_user_id='real-native';assert.equal((await probeUpdateMany(ok,p.d)).body.code,'PROBE_PRECONDITION_BASE44_USER_ID_NOT_ABSENT');assert.equal(p.writes(),0);assert.equal(p.rec.base44_user_id,'real-native');
});
test('if Base44 does not match explicit null, the probe FAILS (reports it) and still restores',async()=>{
 const w=world({},{nullMatchesNull:false});const r=await probeUpdateMany(ok,w.d);
 assert.equal(r.body.code,'PROBE_FAILED');assert.equal(r.body.steps.find(s=>s.name==='null_matches_null').ok,false);
 assert.equal(r.body.restored,true);assert.equal(Object.hasOwn(w.rec,'base44_user_id'),false);assert.equal(w.rec.google_sub,'gsub-secret-value');
});
test('provider error mid-run → PROBE_FAILED and restore of the probe value',async()=>{
 const w=world({},{throwAt:3});const r=await probeUpdateMany(ok,w.d);
 assert.equal(r.body.code,'PROBE_FAILED');assert.equal(r.body.restored,true);assert.equal(Object.hasOwn(w.rec,'base44_user_id'),false);
});
