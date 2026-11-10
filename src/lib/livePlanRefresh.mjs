// Unmanaged results stop this authenticated session's polling. Never cross users.
export function createLivePlanRefresh(fetchPlan,onState){
 let stopped=false,disposed=false,busy=false,initial=true;
 return {
  async refresh(){
   if(stopped||disposed||busy)return;
   busy=true;
   try{
    const result=await fetchPlan();
    if(!result||typeof result.managed!=='boolean')throw Error('INVALID_PLAN_RESPONSE');
    if(!disposed){onState({result,loading:false,unavailable:false});if(result.managed===false)stopped=true;}
   }catch{
    // Do not replace an already rendered subtree or claim that the trial expired.
    if(!disposed)onState({loading:false,unavailable:true,initial});
   }finally{initial=false;busy=false;}
  },
  dispose(){disposed=true;stopped=true;},
 };
}
