import {createClientFromRequest} from 'npm:@base44/sdk@0.8.54';
import {demoRedis} from './demoRegistry.ts';
export default async function getBillingLinkState(req:Request,_ctx:unknown){
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='POST')return reply({code:'METHOD_NOT_ALLOWED'},405);
 // Never activate this endpoint as a blanket legacy migration.
 if(Deno.env.get('BILLING_LIVE_ENFORCEMENT_ENABLED')!=='true')return reply({enforced:false});
 try{
  const client=createClientFromRequest(req);const user=await client.auth.me();
  if(!user?.id)return reply({code:'UNAUTHORIZED'},401);
  const sub=await demoRedis(['GET',`trucky:billing:native:v1:${user.id}`]);
  if(!sub)return reply({enforced:false});
  const members=await client.asServiceRole.entities.OrganizationMember.filter({base44_user_id:user.id,google_sub:sub,active:true});
  return reply({enforced:true,organizations:members.map((m:any)=>({id:m.organization_id}))});
 }catch{return reply({code:'BILLING_STATE_UNAVAILABLE'},503);}
}
