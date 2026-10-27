import {useEffect,useState} from 'react';
import {base44} from '@/api/base44Client';
export default function LiveBillingGate({children}){
 const [state,setState]=useState('loading');
 useEffect(()=>{let active=true;
  (async()=>{
   try{
    await base44.auth.me();
   }catch{if(active)setState('legacy');return;}
   try{
    const response=await base44.functions.invoke('getBillingLinkState',{});
    const body=response.data;
    if(body?.enforced===false){if(active)setState('legacy');return;}
    if(body?.enforced!==true||body.organizations?.length!==1){if(active)setState('blocked');return;}
    const access=await base44.functions.invoke('getLiveBillingAccess',{organization_id:body.organizations[0].id});
    if(active)setState(access.data?.allowed===true?'allowed':'blocked');
   }catch{if(active)setState('error');}
  })();return()=>{active=false;};
 },[]);
 if(state==='loading')return <div role="status" className="min-h-screen flex items-center justify-center">Comprobando acceso…</div>;
 if(state==='legacy'||state==='allowed')return children;
 return <main className="min-h-screen flex flex-col items-center justify-center p-6"><h1>{state==='error'?'No pudimos comprobar la suscripción':'Tu cuenta requiere una suscripción válida'}</h1><p>No se eliminó tu cuenta ni tus datos.</p><a href="https://trucky.site/#pricing">Ver planes</a><button onClick={()=>window.location.reload()}>Consultar de nuevo</button></main>;
}
