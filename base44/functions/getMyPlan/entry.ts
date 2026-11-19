import {autoLinkPublicRuntime} from '../../shared/autoLinkPublicRuntime.ts';
import {createClientFromRequest} from 'npm:@base44/sdk@0.8.54';
import {livePlanForUser,liveBillingRedis} from '../../shared/livePlanRuntime.ts';
import {isCheckoutPending} from '../../shared/checkoutPending.ts';

// Pago en curso (ver shared/checkoutPending.ts): solo agrega checkoutPending=true
// para que la app muestre "Estamos activando tu cuenta…". Nunca cambia allowed ni plan.
async function withCheckoutPending(client:any,user:any,result:any){
 if(result?.allowed===true)return result;
 try{
  const email=String(user?.email||'').toLowerCase();if(!email)return result;
  const rows=await client.asServiceRole.entities.OrganizationMember.filter({user_email:email,active:true});
  const ids=(Array.isArray(rows)?rows:[]).map((m:any)=>m.organization_id);
  return await isCheckoutPending(liveBillingRedis,ids)?{...result,checkoutPending:true}:result;
 }catch{return result;}
}
export default async function getMyPlan(req:Request,_ctx:unknown){
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='POST')return reply({code:'METHOD_NOT_ALLOWED'},405);
 if(Deno.env.get('BILLING_LIVE_ENFORCEMENT_ENABLED')!=='true'){
  try{const client=createClientFromRequest(req),user=await client.auth.me();if(user?.id)return reply(await withCheckoutPending(client,user,{managed:false}));}catch{/* sin aviso */}
  return reply({managed:false});
 }
 try{const client=createClientFromRequest(req),user=await client.auth.me();if(!user?.id)return reply({code:'NATIVE_SESSION_REQUIRED'},401);
  const auto=await autoLinkPublicRuntime(client,user);
  return reply(await withCheckoutPending(client,user,await livePlanForUser(client,user,{fresh:auto.linked===true})));
 }catch{return reply({managed:true,allowed:false,code:'ENTITLEMENT_UNAVAILABLE'},503);}
}
