import {expandedScope} from './enrollment.ts';
import { assertMembershipProvenance } from "./provenance.ts";
import { reserveNativeBinding } from "./binding.ts";
import { demoRedis } from "./demoRegistry.ts";
import { parseIdList } from "./pilot.ts";
import { linkBillingIdentityCore, type VerifiedGoogleIdentity } from "./link.ts";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6';

// Verificación criptográfica del ID token con las llaves públicas de Google
// (firma RS256, emisor, audiencia y expiración). El token nunca va en una URL.
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

async function verifyGoogleIdToken(token: string): Promise<VerifiedGoogleIdentity | null> {
  const audience = Deno.env.get('GOOGLE_CLIENT_ID');
  if (!audience) return null;
  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience,
    algorithms: ['RS256'],
  });
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
  return {
    sub: payload.sub,
    email: payload.email,
    email_verified: payload.email_verified === true || payload.email_verified === 'true',
  };
}

export default async function linkBillingIdentity(req:Request,_ctx:unknown){
 const reply=(code:string,status=200)=>new Response(JSON.stringify({code}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='POST')return reply('METHOD_NOT_ALLOWED',405);
 // Do not enable until client writes to OrganizationMember are restricted.
 const enabled=Deno.env.get('BILLING_IDENTITY_LINK_ENABLED')==='true';
 if(!enabled)return reply('LINK_NOT_ENABLED',503);
 try{
  let body:any=null;
  try{body=await req.json();}catch{return reply('INVALID_REQUEST',400);}
  const client=createClientFromRequest(req);
  const db=client.asServiceRole.entities;
 const nativeUser=await client.auth.me();
 if(!nativeUser?.id||!nativeUser?.email)return reply('NATIVE_SESSION_REQUIRED',401);
 let scope={orgIds:parseIdList(Deno.env.get('BILLING_LINK_PILOT_ORG_IDS')),memberIds:parseIdList(Deno.env.get('BILLING_LINK_PILOT_MEMBER_IDS'))};
 // Recognize existing server enrollments even when new enrollment is closed.
 const general=true;
 let verifiedIdentity:VerifiedGoogleIdentity|null=null;
 if(general){
  if(body?.resume===true&&body.confirm===true){
   const sub=await demoRedis(['GET',`trucky:billing:native:v1:${nativeUser.id}`]);
   if(typeof sub==='string'){const members=await db.OrganizationMember.filter({google_sub:sub,active:true});for(const m of members)scope=await expandedScope(demoRedis,m.organization_id,true,scope.orgIds,scope.memberIds,sub);}
  }else if(typeof body?.google_id_token==='string'&&body.google_id_token.length<=4096){
   verifiedIdentity=await verifyGoogleIdToken(body.google_id_token).catch(()=>null);
   if(verifiedIdentity?.email_verified&&verifiedIdentity.email.toLowerCase()===nativeUser.email.toLowerCase())scope=await expandedScope(demoRedis,body.organization_id,true,scope.orgIds,scope.memberIds,verifiedIdentity.sub);
  }
 }

  const result=await linkBillingIdentityCore(body,{
   enabled,
   pilotOrgIds:scope.orgIds,
   pilotMemberIds:scope.memberIds,
   getUser:async()=>nativeUser,
   verifyGoogleIdToken:async token=>verifiedIdentity??await verifyGoogleIdToken(token),
   redis:demoRedis,
   findMembers:(q)=>db.OrganizationMember.filter(q),
   updateMember:(id,data)=>db.OrganizationMember.update(id,data),
   assertProvenance:assertMembershipProvenance,
   reserveBinding:reserveNativeBinding,
  });
  return reply(result.code,result.status);
 }catch{return reply('LINK_REQUIRES_REVIEW',503);}
}
