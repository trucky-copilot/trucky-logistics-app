import { assertMembershipProvenance } from "./provenance.ts";
import { reserveNativeBinding } from "./binding.ts";
import { demoRedis } from "./demoRegistry.ts";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
export default async function linkBillingIdentity(req:Request,_ctx:unknown){
 const reply=(code:string,status=200)=>new Response(JSON.stringify({code}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='POST')return reply('METHOD_NOT_ALLOWED',405);
 // Do not enable until client writes to OrganizationMember are restricted.
 if(Deno.env.get('BILLING_IDENTITY_LINK_ENABLED')!=='true')return reply('LINK_NOT_ENABLED',503);
 try{
  const client=createClientFromRequest(req);
  const native=await client.auth.me();
  if(!native?.id||!native?.email)return reply('NATIVE_SESSION_REQUIRED',401);
  const body=await req.json();
  if(typeof body.google_id_token!=='string'||body.google_id_token.length>4096||typeof body.organization_id!=='string')return reply('INVALID_REQUEST',400);
  const verified=await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(body.google_id_token)}`,{signal:AbortSignal.timeout(10000)});
  if(!verified.ok)return reply('GOOGLE_AUTHORIZATION_REQUIRED',401);
  const identity=await verified.json();
  if(identity.aud!==Deno.env.get('GOOGLE_CLIENT_ID')||!['accounts.google.com','https://accounts.google.com'].includes(identity.iss)||!(Number(identity.exp)>Date.now()/1000)||!identity.sub||!['true',true].includes(identity.email_verified))return reply('GOOGLE_AUTHORIZATION_REQUIRED',401);
  // Native authenticated session AND independently verified Google ownership.
  if(typeof identity.email!=='string'||identity.email.toLowerCase()!==native.email.toLowerCase())return reply('IDENTITY_MISMATCH',403);
  const db=client.asServiceRole.entities;
  const members=await db.OrganizationMember.filter({organization_id:body.organization_id,google_sub:identity.sub,active:true});
  if(members.length!==1)return reply('VERIFIED_MEMBERSHIP_REQUIRED',403);
  const member=members[0];
  await assertMembershipProvenance(demoRedis,member);
  if(member.base44_user_id&&member.base44_user_id!==native.id)return reply('IDENTITY_ALREADY_BOUND',409);
  // Persistent atomic registry prevents concurrent native identities winning
  // separate database reads. Unknown writes retain the binding for recovery.
  await reserveNativeBinding(demoRedis,identity.sub,native.id);
  if(!member.base44_user_id)await db.OrganizationMember.update(member.id,{base44_user_id:native.id});
  return reply('IDENTITY_LINKED');
 }catch{return reply('LINK_REQUIRES_REVIEW',503);}
}
