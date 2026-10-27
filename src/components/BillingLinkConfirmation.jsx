import {useEffect,useState} from 'react';
import {base44} from '@/api/base44Client';
export default function BillingLinkConfirmation(){
 const [code,setCode]=useState(''),[email,setEmail]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const value=new URLSearchParams(window.location.hash.slice(1)).get('billing_link');if(!value||!/^[a-f0-9]{64}$/.test(value))return;
 // Remove bearer code from address bar immediately; keep in memory only.
 window.history.replaceState(null,'',window.location.pathname+window.location.search);
 setCode(value);base44.auth.me().then(user=>setEmail(user.email||'')).catch(()=>setMessage('Inicia sesión en Trucky y solicita de nuevo la vinculación.'));},[]);
 async function confirm(){setBusy(true);try{const response=await base44.functions.invoke('redeemBillingLink',{code,confirm:true});if(response.data?.code!=='IDENTITY_LINKED')throw Error(response.data?.code||'LINK_FAILED');setCode('');window.location.reload();}catch{setMessage('No se pudo vincular. Solicita un enlace nuevo desde la web; no se ha concedido acceso.');setBusy(false);}}
 if(!code)return null;
 return <div role="dialog" aria-modal="true" aria-label="Confirmar vinculación" className="fixed inset-0 z-[1000] bg-black/70 flex items-center justify-center p-6"><section className="bg-background text-foreground rounded-xl p-6 max-w-md"><h2>Vincular cuenta de facturación</h2><p>Confirma que deseas vincular la cuenta de la web con tu sesión actual de Trucky: {email||'sin sesión verificada'}.</p><button disabled={busy||!email} onClick={confirm}>Confirmar vinculación</button><button disabled={busy} onClick={()=>setCode('')}>Cancelar</button><p role="alert">{message}</p></section></div>;
}
