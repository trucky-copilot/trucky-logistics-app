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
  let body:unknown=null;
  try{body=await req.json();}catch{return reply('INVALID_REQUEST',400);}
  const client=createClientFromRequest(req);
  const db=client.asServiceRole.entities;
  const result=await linkBillingIdentityCore(body,{
   enabled,
   pilotOrgIds:parseIdList(Deno.env.get('BILLING_LINK_PILOT_ORG_IDS')),
   pilotMemberIds:parseIdList(Deno.env.get('BILLING_LINK_PILOT_MEMBER_IDS')),
   getUser:()=>client.auth.me(),
   verifyGoogleIdToken,
   redis:demoRedis,
   findMembers:(q)=>db.OrganizationMember.filter(q),
   updateMember:(id,data)=>db.OrganizationMember.update(id,data),
   assertProvenance:assertMembershipProvenance,
   reserveBinding:reserveNativeBinding,
  });
  return reply(result.code,result.status);
 }catch{return reply('LINK_REQUIRES_REVIEW',503);}
}
