import {strict as assert} from 'node:assert';
import {ensureUserOrganization} from '../../base44/functions/ensureUserOrganization/handler.ts';
import {AUTO_BIND_PUBLIC} from '../../base44/shared/autoLinkPublicAccount.ts';
Deno.test('published onboarding handler reuses exact public company after verified native login; no create',async()=>{
 const saved=Deno.env.get('BILLING_IDENTITY_LINK_ENABLED');Deno.env.set('BILLING_IDENTITY_LINK_ENABLED','true');
 const user={id:'native',email:'new@example.invalid',is_verified:true};const org={id:'org',name:'Cuenta new',created_by_user:user.email,active:true};
 const member:any={id:'member',organization_id:'org',google_sub:'google',user_email:user.email,role:'owner',active:true};
 const entry=JSON.stringify({version:1,orgId:'org',memberId:'member',googleSub:'google',role:'owner',origin:'landing_public_new'}),proof=JSON.stringify({orgId:'org',memberId:'member',googleSub:'google',role:'owner'});
 const map=new Map<string,unknown>([['trucky:billing:enrollment:v1:org:org',entry],['trucky:billing:member:v1:org:google',proof]]);
 const match=(r:any,q:any)=>Object.entries(q).every(([k,v]:any)=>v&&typeof v==='object'&&'$exists'in v?Object.hasOwn(r,k)===v.$exists:r[k]===v);
 let created=0;
 const db={Organization:{filter:async(q:any)=>match(org,q)?[org]:[],create:async()=>{created++;throw Error('must not create');}},OrganizationMember:{filter:async(q:any)=>match(member,q)?[{...member}]:[],create:async()=>{created++;throw Error('must not create');},updateMany:async(q:any,{ $set }:any)=>{if(!match(member,q))return{updated:0};Object.assign(member,$set);return{updated:1};}}};
 const redis=async(c:unknown[])=>{if(c[0]==='GET')return map.get(String(c[1]))??null;if(c[0]==='EVAL'&&c[1]===AUTO_BIND_PUBLIC){const k=c.slice(3,9).map(String),a=c.slice(9);if(map.get(k[2])!==a[2]||map.get(k[3])!==a[3]||map.get(k[5])!==a[5])return -1;map.set(k[0],a[0]);map.set(k[1],a[1]);return 1;}throw Error('unexpected');};
 try{
 const response=await ensureUserOrganization(new Request('https://example.invalid',{method:'POST',body:'{}'}),{user,db,redis});assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'existing',org_id:'org',name:'Cuenta new'});assert.equal(member.base44_user_id,'native');assert.equal(created,0);
 }finally{saved===undefined?Deno.env.delete('BILLING_IDENTITY_LINK_ENABLED'):Deno.env.set('BILLING_IDENTITY_LINK_ENABLED',saved);}
});
