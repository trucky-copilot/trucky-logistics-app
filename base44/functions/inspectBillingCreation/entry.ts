import {createClientFromRequest} from 'npm:@base44/sdk@0.8.54';import {demoRedis} from './demoRegistry.ts';import {inspectCreation} from './inspect.ts';
export default async function handler(req:Request,_ctx:unknown){
 const h={'Content-Type':'application/json','Cache-Control':'no-store'};
 if(req.method!=='POST')return new Response(JSON.stringify({code:'METHOD_NOT_ALLOWED'}),{status:405,headers:h});
 try{const client=createClientFromRequest(req),db=client.asServiceRole.entities;
 const r=await inspectCreation(await req.json(),{enabled:Deno.env.get('BILLING_CREATION_INSPECTION_ENABLED')==='true',adminIds:new Set((Deno.env.get('BILLING_CREATION_INSPECTION_ADMIN_IDS')||'').split(',').map(s=>s.trim()).filter(Boolean)),user:()=>client.auth.me(),redis:demoRedis,members:q=>db.OrganizationMember.filter(q),orgs:q=>db.Organization.filter(q)});
 return new Response(JSON.stringify(r.body),{status:r.status,headers:h});}catch{return new Response(JSON.stringify({code:'CREATION_INSPECTION_REQUIRES_REVIEW'}),{status:503,headers:h});}
}
