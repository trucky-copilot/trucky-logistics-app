export async function inspectCreation(body:any,d:{enabled:boolean;adminIds:Set<string>;user:()=>Promise<any>;redis:(c:unknown[])=>Promise<any>;members:(q:any)=>Promise<any[]>;orgs:(q:any)=>Promise<any[]>}){
 const out=(code:string,status=200,extra:Record<string,unknown>={})=>({status,body:{code,...extra}});
 if(!d.enabled)return out('INSPECTION_DISABLED',503);
 const user=await d.user().catch(()=>null);if(!user?.id)return out('ADMIN_SESSION_REQUIRED',401);
 if(user.role!=='admin'||!d.adminIds.has(user.id))return out('ADMIN_NOT_AUTHORIZED',403);
 if(typeof body?.google_sub!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(body.google_sub)||typeof body?.company_name!=='string'||!body.company_name.trim()||body.company_name.length>120)return out('INVALID_REQUEST',400);
 try{
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${body.google_sub}:${body.company_name.trim().toLowerCase()}`)))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const state=await d.redis(['GET',`trucky:billing:create:v1:attempt:${hash}`]);
  const members=await d.members({google_sub:body.google_sub,active:true});
  const rows=[];for(const m of members){const orgs=await d.orgs({id:m.organization_id});for(const o of orgs)if(String(o.name).toLowerCase()===body.company_name.trim().toLowerCase())rows.push({organization_id:o.id,member_id:m.id,active:o.active===true});}
  // No DEL, no recovery/execution branch, no attempt to infer absence of in-flight writes.
  const completed=typeof state==='string'&&rows.some(r=>r.organization_id===state);
  return out('CREATION_INSPECTED',200,{reservation_present:state!=null,reservation_completed:completed,candidates:rows,may_have_unfinished_write:state!=null&&!completed,no_automatic_release:true});
 }catch{return out('CREATION_INSPECTION_REQUIRES_REVIEW',503);}
}
