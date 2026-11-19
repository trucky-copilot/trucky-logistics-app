import {verifiedScope} from './verifiedScope.ts';
import {createClientFromRequest} from 'npm:@base44/sdk@0.8.54';
import {demoRedis} from './demoRegistry.ts';
import {assertMembershipProvenance} from './provenance.ts';
import {eligibilityHttp} from './http.ts';
import {repairLandingProvenance} from '../../shared/landingRepair.ts';
import {markCheckoutPending} from '../../shared/checkoutPending.ts';
export default async function handler(req:Request,_ctx:unknown){
 const contextRequest=req.clone();
 const response=await eligibilityHttp(req,{
  secret:Deno.env.get('TRUCKY_SERVER_SECRET'),
  enabled:Deno.env.get('BILLING_LIVE_CHECKOUT_ELIGIBILITY_ENABLED')==='true',syncEnabled:Deno.env.get('BILLING_SYNC_LIVE_ENABLED')==='true',
  makeDeps:async()=>{
   const db=createClientFromRequest(req).asServiceRole.entities;
   const input=await contextRequest.json();
   // Empresa de la landing sin procedencia: se recupera con evidencia del servidor
   // (google_sub + intento de creación), nunca por correo. Si no aplica, sigue igual.
   if(typeof input?.google_sub==='string'&&typeof input?.organization_id==='string'){
    try{
     const fix=await repairLandingProvenance(demoRedis,db,input.google_sub,input.organization_id);
     if(fix.repaired)console.warn('[checkLiveCheckoutEligibility]',JSON.stringify({code:'LANDING_ORGANIZATION_REPAIRED'}));
     else if(fix.reason!=='ALREADY_COMPLETE')console.warn('[checkLiveCheckoutEligibility]',JSON.stringify({code:'LANDING_REPAIR_SKIPPED',reason:fix.reason}));
    }catch{/* la elegibilidad decide igual */}
   }
   const scope=await verifiedScope(demoRedis,q=>db.OrganizationMember.filter(q),assertMembershipProvenance,input.organization_id,input.google_sub);
   return {enabled:true,syncEnabled:true,orgIds:scope.orgIds,memberIds:scope.memberIds,
    redis:demoRedis,provenance:assertMembershipProvenance,members:q=>db.OrganizationMember.filter(q),orgs:id=>db.Organization.filter({id})};
  },
 });
 // Puede pagar: se marca "pago en curso" (solo un aviso en la app, nunca da acceso).
 if(response.status===200){
  try{
   const out=await response.clone().json();
   if(out?.code==='LIVE_CHECKOUT_ELIGIBLE'&&await markCheckoutPending(demoRedis,out.organization_id))
    console.warn('[checkLiveCheckoutEligibility]',JSON.stringify({code:'CHECKOUT_PENDING_MARKED'}));
  }catch{/* el aviso es opcional: la elegibilidad responde igual */}
 }
 return response;
}
