import {createClientFromRequest} from 'npm:@base44/sdk@0.8.54';
import {demoRedis} from './demoRegistry.ts';
import {assertMembershipProvenance} from './provenance.ts';
import {eligibilityHttp} from './http.ts';
const ids=(s:string|undefined)=>new Set((s||'').split(',').map(v=>v.trim()).filter(Boolean));
export default async function handler(req:Request,_ctx:unknown){
 return eligibilityHttp(req,{
  secret:Deno.env.get('TRUCKY_SERVER_SECRET'),
  enabled:Deno.env.get('BILLING_LIVE_CHECKOUT_ELIGIBILITY_ENABLED')==='true',syncEnabled:Deno.env.get('BILLING_SYNC_LIVE_ENABLED')==='true',
  makeDeps:()=>{
   const db=createClientFromRequest(req).asServiceRole.entities;
   return {enabled:true,syncEnabled:true,orgIds:ids(Deno.env.get('BILLING_LINK_PILOT_ORG_IDS')),memberIds:ids(Deno.env.get('BILLING_LINK_PILOT_MEMBER_IDS')),
    redis:demoRedis,provenance:assertMembershipProvenance,members:q=>db.OrganizationMember.filter(q),orgs:id=>db.Organization.filter({id})};
  },
 });
}
