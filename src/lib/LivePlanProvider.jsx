import {createContext,useContext,useEffect,useState} from 'react';
import {base44} from '@/api/base44Client';
import {useAuth} from './AuthContext';
import {useAppState} from './AppStateContext';
import {createLivePlanRefresh} from './livePlanRefresh.mjs';
import {useDemo} from './DemoContext';
import {livePlanView} from './livePlanView.mjs';
const Context=createContext({managed:false});
export const useLivePlan=()=>useContext(Context);
export function LivePlanProvider({children}){
 const {user}=useAuth();const {organization}=useAppState();
 const [state,setState]=useState({result:null,loading:true,unavailable:false});
 useEffect(()=>{
  setState({result:null,loading:!!user?.id,unavailable:false});
  if(!user?.id)return;
  const refresh=createLivePlanRefresh(async()=>(await base44.functions.invoke('getMyPlan',{})).data,update=>setState(previous=>({...previous,...update})));
  void refresh.refresh();
  const focus=()=>void refresh.refresh();window.addEventListener('focus',focus);
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh.refresh();},60000);
  return()=>{refresh.dispose();clearInterval(timer);window.removeEventListener('focus',focus);};
 },[user?.id]);
 const view=livePlanView(state.result,organization?.id);
 return <Context.Provider value={{...view,allowed:state.result?.allowed===true&&!view.blocked,loading:state.loading,unavailable:state.unavailable,code:state.result?.code}}>{children}</Context.Provider>;
}
// Compose paid display with existing demo defaults; DemoContext itself is untouched.
export function useEffectivePlan(){
 const demo=useDemo(),live=useLivePlan();
 if(!live.managed)return demo;
 const plan=live.allowed?live.plan:'demo';
 return {...demo,planType:plan,isDemoUser:plan==='demo',isPlan29:plan==='plan_29',isPlan99:plan==='plan_99',isWhitelisted:false,isSubscribed:live.allowed,limits:demo.planLimits?.[plan]||demo.limits,canAnalyzeInChat:Boolean(demo.planLimits?.[plan]?.ANALYZE_IN_CHAT)};
}
export function LivePlanBoundary({children}){
 const live=useLivePlan();
 if(live.loading)return <div role="status" className="p-6">Verificando cuenta…</div>;
 // A transient error is a notice, not a fake subscription denial. Server gates
 // remain authoritative and reject unverified protected operations.
 if(live.managed&&live.blocked)return <main className="min-h-screen flex items-center justify-center p-6"><section className="max-w-md space-y-4 border rounded-xl p-6"><h1 className="text-xl font-semibold">Verifica tu suscripción</h1><p>No pudimos confirmar una suscripción vigente para esta cuenta y empresa. No crees otra si ya pagaste.</p><p role="status">{live.code}</p><a className="block underline" href="https://www.trucky-ai.com">Volver a Trucky web</a></section></main>;
 return <>{live.unavailable&&<div role="status">No pudimos actualizar el estado de tu plan. Reintentaremos sin cerrar tu sesión.</div>}{children}</>;
}
