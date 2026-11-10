// UI mirrors a server result; it never authorizes server operations.
export function livePlanView(result,organizationId){
 if(result==null)return {managed:false,loading:true,plan:null,blocked:false};
 if(result.managed!==true)return {managed:false,loading:false,plan:null,blocked:false};
 const valid=result.allowed===true&&['plan_29','plan_99'].includes(result.plan)&&typeof result.organizationId==='string'&&(!organizationId||result.organizationId===organizationId);
 return {managed:true,loading:false,plan:valid?result.plan:'demo',blocked:!valid};
}
