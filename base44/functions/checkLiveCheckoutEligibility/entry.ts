import {verifiedScope} from './verifiedScope.ts';
import {createClientFromRequest} from 'npm:@base44/sdk@0.8.54';
import {demoRedis} from './demoRegistry.ts';
import {assertMembershipProvenance} from './provenance.ts';
import {eligibilityHttp} from './http.ts';
const ids=(s:string|undefined)=>new Set((s||'').split(',').map(v=>v.trim()).filter(Boolean));
export default async function handler(req:Request,_ctx:unknown){
 const contextRequest=req.clone();
 return eligibilityHttp(req,{
  secret:Deno.env.get('TRUCKY_SERVER_SECRET'),
  enabled:Deno.env.get('BILLING_LIVE_CHECKOUT_ELIGIBILITY_ENABLED')==='true',syncEnabled:Deno.env.get('BILLING_SYNC_LIVE_ENABLED')==='true',
  makeDeps:async()=>{
   const db=createClientFromRequest(req).asServiceRole.entities;
   const input=await contextRequest.json();
   const scope=await verifiedScope(demoRedis,q=>db.OrganizationMember.filter(q),assertMembershipProvenance,input.organization_id,input.google_sub);
   return {enabled:true,syncEnabled:true,orgIds:scope.orgIds,memberIds:scope.memberIds,
    redis:demoRedis,provenance:assertMembershipProvenance,members:q=>db.OrganizationMember.filter(q),orgs:id=>db.Organization.filter({id})};
  },
 });
}
