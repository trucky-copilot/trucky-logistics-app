import type {EligibilityDeps} from './eligibility.ts';
import {checkEligibility} from './eligibility.ts';
export interface HttpDeps {secret?:string;enabled:boolean;syncEnabled:boolean;makeDeps:()=>EligibilityDeps|Promise<EligibilityDeps>}
export async function eligibilityHttp(req:Request,d:HttpDeps){
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 const reply=(code:string,status:number)=>new Response(JSON.stringify({code}),{status,headers});
 if(req.method!=='POST')return reply('METHOD_NOT_ALLOWED',405);
 if(!d.secret)return reply('UNAUTHORIZED',401);
 const digest=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const a=await digest(req.headers.get('authorization')||''),b=await digest(`Bearer ${d.secret}`);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];if(diff)return reply('UNAUTHORIZED',401);
 if(!d.enabled||!d.syncEnabled)return reply('LIVE_CHECKOUT_NOT_READY',503);
 let body:Record<string,unknown>;
 try{body=await req.json();}catch{return reply('INVALID_REQUEST',400);}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['google_sub','organization_id'].includes(k))||typeof body.google_sub!=='string'||typeof body.organization_id!=='string')return reply('INVALID_REQUEST',400);
 try{
  const result=await checkEligibility(body.google_sub,body.organization_id,await d.makeDeps());
  return new Response(JSON.stringify(result.body),{status:result.status,headers});
 }catch(error){
  if(error instanceof Error&&error.message==='BILLING_ACCOUNT_REVIEW_REQUIRED')return reply('BILLING_ACCOUNT_REVIEW_REQUIRED',409);
  return reply('LIVE_CHECKOUT_REQUIRES_REVIEW',503);
 }
}
