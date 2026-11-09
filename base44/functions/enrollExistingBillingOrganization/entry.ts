import {createClientFromRequest} from 'npm:@base44/sdk@0.8.54';
import {createRemoteJWKSet,jwtVerify} from 'npm:jose@5.9.6';
import {demoRedis} from './demoRegistry.ts';
import {enrollExisting} from './existing.ts';
const jwks=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export default async function handler(req:Request,_ctx:unknown){
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 if(req.method!=='POST')return new Response(JSON.stringify({code:'METHOD_NOT_ALLOWED'}),{status:405,headers});
 if(Deno.env.get('BILLING_EXISTING_ENROLLMENT_ENABLED')!=='true')return new Response(JSON.stringify({code:'EXISTING_ENROLLMENT_DISABLED'}),{status:503,headers});
 try{
  const client=createClientFromRequest(req),db=client.asServiceRole.entities;
  const r=await enrollExisting(await req.json(),{enabled:true,adminIds:new Set((Deno.env.get('BILLING_EXISTING_ENROLLMENT_ADMIN_IDS')||'').split(',').map(s=>s.trim()).filter(Boolean)),
   trustedServer:async()=>{const secret=Deno.env.get('TRUCKY_SERVER_SECRET');if(!secret)return false;const digest=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));const a=await digest(req.headers.get('authorization')||''),b=await digest(`Bearer ${secret}`);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;},
   native:()=>client.auth.me(),redis:demoRedis,now:()=>Date.now(),id:()=>crypto.randomUUID(),
   google:async token=>{const audience=Deno.env.get('GOOGLE_CLIENT_ID');if(!audience)throw Error();const {payload}=await jwtVerify(token,jwks,{issuer:['accounts.google.com','https://accounts.google.com'],audience,algorithms:['RS256'],requiredClaims:['exp','iat','sub','email']});return {...payload,email_verified:payload.email_verified===true};},
   member:async id=>(await db.OrganizationMember.filter({id}))[0],org:async id=>(await db.Organization.filter({id}))[0],owners:id=>db.OrganizationMember.filter({organization_id:id,role:'owner',active:true}),
   updateMember:(query,fields)=>db.OrganizationMember.updateMany(query,{$set:fields}),
  });return new Response(JSON.stringify(r.body),{status:r.status,headers});
 }catch{return new Response(JSON.stringify({code:'EXISTING_ENROLLMENT_REQUIRES_REVIEW'}),{status:503,headers});}
}
