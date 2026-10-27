import {createClientFromRequest} from 'npm:@base44/sdk@0.8.54';
import {demoRedis} from './demoRegistry.ts';
import {reserveNativeBinding} from './binding.mjs';
import {assertMembershipProvenance} from './provenance.mjs';
export default async function redeemBillingLink(req:Request,_ctx:unknown){
 const reply=(code:string,status=200)=>new Response(JSON.stringify({code}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='POST')return reply('METHOD_NOT_ALLOWED',405);
 if(Deno.env.get('BILLING_IDENTITY_LINK_ENABLED')!=='true')return reply('LINK_NOT_ENABLED',503);
 try{
  const client=createClientFromRequest(req),user=await client.auth.me();
  if(!user?.id||!user?.email)return reply('NATIVE_SESSION_REQUIRED',401);
  const body=await req.json();
  if(body.confirm!==true||typeof body.code!=='string'||!/^[a-f0-9]{64}$/.test(body.code))return reply('INVALID_REQUEST',400);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.code)))).map(b=>b.toString(16).padStart(2,'0')).join('');
  // Verify account match before consuming; then GETDEL prevents replay.
  const key=`trucky:billing:handoff:v1:${digest}`;
  const raw=await demoRedis(['GET',key]);
  if(!raw)return reply('LINK_EXPIRED',409);
  const identity=JSON.parse(raw);
  if(identity.email!==user.email.toLowerCase())return reply('IDENTITY_MISMATCH',403);
  const consumed=await demoRedis(['GETDEL',key]);
  if(consumed!==raw)return reply('LINK_ALREADY_USED',409);
  const db=client.asServiceRole.entities;
  const members=await db.OrganizationMember.filter({organization_id:identity.orgId,google_sub:identity.sub,active:true});
  if(members.length!==1)return reply('VERIFIED_MEMBERSHIP_REQUIRED',403);
  const member=members[0];await assertMembershipProvenance(demoRedis,member);
  if(member.base44_user_id&&member.base44_user_id!==user.id)return reply('IDENTITY_ALREADY_BOUND',409);
  await reserveNativeBinding(demoRedis,identity.sub,user.id);
  if(!member.base44_user_id)await db.OrganizationMember.update(member.id,{base44_user_id:user.id});
  await demoRedis(['SET',`trucky:billing:native:v1:${user.id}`,identity.sub,'NX']);
  return reply('IDENTITY_LINKED');
 }catch{return reply('LINK_REQUIRES_REVIEW',503);}
}
