import {verifiedScope} from './verifiedScope.ts';
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
 let body:any=null;
 try{body=await req.json();}catch{return reply('INVALID_REQUEST',400);}
 const client=createClientFromRequest(req);
 const db=client.asServiceRole.entities;
 const nativeUser=await client.auth.me();
 if(!nativeUser?.id||!nativeUser?.email)return reply('NATIVE_SESSION_REQUIRED',401);
 let scope={orgIds:new Set<string>(),memberIds:new Set<string>()};
 // Recognize existing server enrollments even when new enrollment is closed.
 const general=true;
 if(general&&body?.confirm===true){
  if(body.resume===true){
   const sub=await demoRedis(['GET',`trucky:billing:native:v1:${nativeUser.id}`]);
   if(typeof sub==='string'){
    const members=await db.OrganizationMember.filter({google_sub:sub,active:true});
    for(const m of members){const v=await verifiedScope(demoRedis,q=>db.OrganizationMember.filter(q),assertMembershipProvenance,m.organization_id,sub);scope={orgIds:new Set([...scope.orgIds,...v.orgIds]),memberIds:new Set([...scope.memberIds,...v.memberIds])};}
   }
  }else if(typeof body.code==='string'&&/^[a-f0-9]{64}$/.test(body.code)){
   const raw=await demoRedis(['GET',`trucky:billing:handoff:v1:${await sha256Hex(body.code)}`]);
   if(raw){const ticket=JSON.parse(String(raw));if(ticket.email===nativeUser.email.toLowerCase())scope=await verifiedScope(demoRedis,q=>db.OrganizationMember.filter(q),assertMembershipProvenance,ticket.orgId,ticket.sub);}
  }
 }

 const result=await redeemBillingLinkCore(body,{
  enabled,
  // Same verified membership rule for every Google identity; no pilot list.
  pilotOrgIds:scope.orgIds,
  pilotMemberIds:scope.memberIds,
  getUser:async()=>nativeUser,
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
