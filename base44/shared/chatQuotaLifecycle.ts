import {settleLiveChat} from './liveChatQuota.ts';
export interface ChatReservation {access:any;requestId:string}
/** A returned error is known BEFORE delivery. A thrown/transport outcome is not. */
export async function runMeteredChat(
 run:(capture:(reservation:ChatReservation)=>void)=>Promise<Response>,
 settle:(r:ChatReservation,outcome:'completed'|'confirmed_failure'|'uncertain')=>Promise<unknown>=(r,o)=>settleLiveChat(r.access,r.requestId,o),
){
 let reservation:ChatReservation|undefined;
 let response:Response;
 try{response=await run(r=>{reservation=r;});}
 catch(error){
  if(reservation){try{await settle(reservation,'uncertain');}catch{/* retain debit; no refund on unknown */}}
  throw error;
 }
 if(!reservation)return response;
 // Parsing/classification cannot consume/alter the original response stream.
 let payload:any;
 try{payload=await response.clone().json();}catch{
  try{await settle(reservation,'uncertain');}catch{}
  return response;
 }
 const failed=response.status>=400||Boolean(payload?.error);
 // A successful returned answer is settled before transport. Network loss after
 // return is uncertain and must never trigger a client-requested refund.
 const outcome=failed?'confirmed_failure':typeof payload?.content==='string'&&payload.content.trim()?'completed':'uncertain';
 let settlement:any;
 try{settlement=await settle(reservation,outcome);}
 catch{
  if(failed)return Response.json({error:'La solicitud falló. El estado de la devolución requiere revisión.',code:'CHAT_REFUND_REQUIRES_REVIEW'},{status:503,headers:response.headers});
  return response; // response may still be delivered; keep consumed, never refund
 }
 if(failed)return Response.json({error:payload.error||'No se pudo completar la respuesta.',code:settlement?.code||'CHAT_FAILED',request_id:reservation.requestId},{status:503,headers:response.headers});
 return response;
}
