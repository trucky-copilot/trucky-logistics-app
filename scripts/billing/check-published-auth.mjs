// No secrets accepted. Negative tests only; does not create or mutate resources.
const base='https://trucky-17a283d5.base44.app/api/functions/';
const cases=[
 ['syncBillingSubscription','UNAUTHORIZED'],
 ['checkLiveBillingConfiguration','UNAUTHORIZED'],
];
let failed=false;
for(const [name,expected] of cases){
 try{
  const response=await fetch(base+name,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>null);
  const ok=response.status===401&&data?.code===expected;
  console.log(JSON.stringify({function:name,httpStatus:response.status,expectedCode:expected,passed:ok}));
  if(!ok)failed=true;
 }catch{console.log(JSON.stringify({function:name,passed:false,error:'NETWORK_OR_RUNTIME_UNAVAILABLE'}));failed=true;}
}
process.exitCode=failed?1:0;
