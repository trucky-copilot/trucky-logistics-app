import {autoLinkPublicAccount} from './autoLinkPublicAccount.ts';
import {liveBillingRedis} from './livePlanRuntime.ts';
export function autoLinkPublicRuntime(client:any,user:any){
 if(Deno.env.get('BILLING_IDENTITY_LINK_ENABLED')!=='true')return Promise.resolve({code:'LINK_NOT_ENABLED',linked:false});
 const db=client.asServiceRole.entities;
 return autoLinkPublicAccount(user,{redis:liveBillingRedis,members:q=>db.OrganizationMember.filter(q),orgs:q=>db.Organization.filter(q),update:(q,f)=>db.OrganizationMember.updateMany(q,{$set:f})});
}
