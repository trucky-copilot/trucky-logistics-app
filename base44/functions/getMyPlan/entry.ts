import {createClientFromRequest} from 'npm:@base44/sdk@0.8.54';
import {livePlanForUser} from '../../shared/livePlanRuntime.ts';
export default async function getMyPlan(req:Request,_ctx:unknown){
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='POST')return reply({code:'METHOD_NOT_ALLOWED'},405);
 if(Deno.env.get('BILLING_LIVE_ENFORCEMENT_ENABLED')!=='true')return reply({managed:false});
 try{const client=createClientFromRequest(req),user=await client.auth.me();if(!user?.id)return reply({code:'NATIVE_SESSION_REQUIRED'},401);
  return reply(await livePlanForUser(client,user));
 }catch{return reply({managed:true,allowed:false,code:'ENTITLEMENT_UNAVAILABLE'},503);}
}
