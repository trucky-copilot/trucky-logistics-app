import {createClientFromRequest} from 'npm:@base44/sdk@0.8.54';
import {demoRedis} from './demoRegistry.ts';
import {reserveNativeBinding} from './binding.ts';
import {assertMembershipProvenance} from './provenance.ts';
import {redeemBillingLinkCore} from './redeem.ts';
import {parseIdList} from './pilot.ts';

async function sha256Hex(text:string){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(b=>b.toString(16).padStart(2,'0')).join('');
}

export default async function redeemBillingLink(req:Request,_ctx:unknown){
 const reply=(code:string,status=200)=>new Response(JSON.stringify({code}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='POST')return reply('METHOD_NOT_ALLOWED',405);
 const enabled=Deno.env.get('BILLING_IDENTITY_LINK_ENABLED')==='true';
 if(!enabled)return reply('LINK_NOT_ENABLED',503);
 try{
 let body:unknown=null;
 try{body=await req.json();}catch{return reply('INVALID_REQUEST',400);}
 const client=createClientFromRequest(req);
 const db=client.asServiceRole.entities;
 const result=await redeemBillingLinkCore(body,{
  enabled,
  // Piloto restringido en el backend: BILLING_LINK_PILOT_ORG_IDS y BILLING_LINK_PILOT_MEMBER_IDS.
  pilotOrgIds:parseIdList(Deno.env.get('BILLING_LINK_PILOT_ORG_IDS')),
  pilotMemberIds:parseIdList(Deno.env.get('BILLING_LINK_PILOT_MEMBER_IDS')),
  getUser:()=>client.auth.me(),
  redis:demoRedis,
  findMembers:(q)=>db.OrganizationMember.filter(q),
  updateMember:(id,data)=>db.OrganizationMember.update(id,data),
  assertProvenance:assertMembershipProvenance,
  reserveBinding:reserveNativeBinding,
  sha256Hex,
 });
 return reply(result.code,result.status);
 }catch{return reply('LINK_REQUIRES_REVIEW',503);}
}
