// Per-worker cache: no tokens; short maximum revocation delay, no sliding expiry.
// A provider failure can reuse only a previously verified result for <=30s total.
export function createLivePlanCache(now=()=>Date.now()){
 const entries=new Map<string,{at:number;value:any}>();
 const inflight=new Map<string,Promise<any>>();
 return async<T>(key:string,load:()=>Promise<T>):Promise<T>=>{
  const previous=entries.get(key),age=previous?now()-previous.at:Infinity;
  if(previous&&age>=0&&age<5000)return previous.value;
  if(inflight.has(key))return inflight.get(key)!;
  const recentAllow=()=>previous?.value.allowed===true&&now()-previous.at>=0&&now()-previous.at<30000;
  const work=(async()=>{
   try{
    const value:any=await load();
    if(value.code==='LIVE_SYNC_PENDING'){
     if(previous&&previous&&recentAllow())return previous.value;
     return value;
    }
    // Explicit denial invalidates any previously allowed result immediately.
    if(entries.size>=1000)entries.delete(entries.keys().next().value!);
    entries.set(key,{at:now(),value});return value;
   }catch(error){
    if(error instanceof Error&&['REDIS_UNAVAILABLE','LIVE_SUBSCRIPTION_UNAVAILABLE'].includes(error.message)&&previous&&recentAllow())return previous.value;
    throw error;
   }finally{inflight.delete(key);}
  })();inflight.set(key,work);return work;
 };
}
