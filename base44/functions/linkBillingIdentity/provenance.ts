export function provenanceKey(orgId:string,sub:string){
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(orgId||'')||!/^[a-zA-Z0-9_-]{1,128}$/.test(sub||''))throw Error('INVALID_MEMBERSHIP_IDENTITY');
 return `trucky:billing:member:v1:${orgId}:${sub}`;
}
export async function assertMembershipProvenance(command:(c:unknown[])=>Promise<unknown>,member:{organization_id:string;google_sub:string;id:string;role:string}){
 const raw=await command(['GET',provenanceKey(member.organization_id,member.google_sub)]);
 if(!raw)throw Error('MEMBERSHIP_PROVENANCE_REQUIRED');
 const value=JSON.parse(String(raw));
 if(value.memberId!==member.id||value.role!==member.role||value.googleSub!==member.google_sub||value.orgId!==member.organization_id)throw Error('MEMBERSHIP_PROVENANCE_MISMATCH');
}
