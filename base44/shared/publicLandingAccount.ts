export type Redis=(c:unknown[])=>Promise<unknown>;
export const safeId=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
export async function landingOriginEvidence(redis:Redis,org:any,member:any,entry:any){
 if(entry.origin==='landing_public_new')return {key:`trucky:billing:enrollment:v1:org:${org.id}`,value:JSON.stringify(entry)};
 if(entry.origin!==undefined||typeof org.name!=='string'||!safeId(member.google_sub))return null;
 // Historical public-new registrations had no origin field. A finalized creation
 // receipt is separate server-owned evidence; never infer origin from email.
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${member.google_sub}:${org.name.toLowerCase()}`));
 const hash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
 const key=`trucky:billing:create:v1:attempt:${hash}`;
 return await redis(['GET',key])===org.id?{key,value:org.id}:null;
}
/** Only newly created public landing companies. Recognition survives closing signup. */
export async function publicLandingAccount(redis:Redis,org:any,member:any,members:(q:any)=>Promise<any[]>){
 if(!safeId(org?.id)||org.active!==true||!safeId(member?.id)||!safeId(member.google_sub)||member.organization_id!==org.id||member.active!==true||member.role!=='owner')return false;
 const raw=await redis(['GET',`trucky:billing:enrollment:v1:org:${org.id}`]);
 if(raw==null)return false;
 const entry=JSON.parse(String(raw));
 if(entry.version!==1||entry.orgId!==org.id||entry.memberId!==member.id||entry.googleSub!==member.google_sub||entry.role!=='owner')throw Error('ENROLLMENT_CONFLICT');
 // Reviewed legacy enrollments use the same key: never infer new origin from key alone.
 if(!await landingOriginEvidence(redis,org,member,entry))return false;
 const proofRaw=await redis(['GET',`trucky:billing:member:v1:${org.id}:${member.google_sub}`]);
 if(!proofRaw)throw Error('MEMBERSHIP_PROVENANCE_REQUIRED');
 const p=JSON.parse(String(proofRaw));
 if(p.memberId!==member.id||p.orgId!==org.id||p.googleSub!==member.google_sub||p.role!=='owner')throw Error('MEMBERSHIP_PROVENANCE_MISMATCH');
 const owners=await members({organization_id:org.id,role:'owner',active:true});
 if(owners.length!==1||owners[0].id!==member.id||owners[0].google_sub!==member.google_sub)return false;
 return true;
}
