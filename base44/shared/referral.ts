// PM-03 · Código de referido. La web (trucky-ai.com/?invita=CODIGO) pone el código en
// la metadata de la suscripción de Stripe (referral_code). Después de activar el plan,
// se marca la empresa como referida en una escritura APARTE: nunca cambia el plan, el
// acceso ni el resultado de la sincronización, y cualquier fallo se ignora.
export const REFERRAL_CODE=/^[A-HJKMNP-Z2-9]{8}$/;
export interface ReferralDeps{
 organization:(id:string)=>Promise<any|undefined>;
 /** UserProfile con ese codigo_invitacion. */
 referrers:(code:string)=>Promise<any[]>;
 /** Miembros activos de la empresa (para no aceptar el propio código). */
 members:(orgId:string)=>Promise<any[]>;
 update:(id:string,fields:Record<string,unknown>)=>Promise<unknown>;
 now?:()=>number;
}
export async function markReferral(sub:any,orgId:string,d:ReferralDeps):Promise<string>{
 const code=sub?.metadata?.referral_code;
 if(typeof code!=='string'||!REFERRAL_CODE.test(code))return'NO_REFERRAL';
 if(sub?.metadata?.org_id!==orgId)return'ORG_MISMATCH';
 const org=await d.organization(orgId);
 if(!org||org.id!==orgId)return'ORG_NOT_FOUND';
 if(org.referido_por)return'ALREADY_MARKED';
 const refs=(await d.referrers(code)).filter(r=>r?.codigo_invitacion===code);
 if(refs.length!==1)return'REFERRER_NOT_FOUND';
 const referrer=String(refs[0].usuario||'').toLowerCase();
 const own=(await d.members(orgId)).some(m=>String(m?.user_email||'').toLowerCase()===referrer);
 if(!referrer||own)return'SELF_REFERRAL';
 await d.update(orgId,{referido_por:code,referido_en:new Date((d.now??Date.now)()).toISOString()});
 return'MARKED';
}
