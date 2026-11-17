// Consulta Stripe directo (sin la librería npm:stripe, que fallaba dentro de
// Base44 y devolvía siempre LIVE_CONFIGURATION_UNAVAILABLE). Mismo patrón que
// shared/livePlanRuntime.ts. Nunca devuelve llaves ni detalles de Stripe.
export default async function checkLiveBillingConfiguration(req:Request,_ctx:unknown){
 // Diagnóstico en los logs de Base44 (nunca llaves ni secretos): qué código se
 // devolvió, qué precio falló y qué respondió Stripe.
 const reply=(code:string,status=200,extra:Record<string,unknown>={})=>{
  if(status!==200)console.warn('[checkLiveBillingConfiguration]',JSON.stringify({code,status,...extra}));
  return new Response(JSON.stringify({code}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 };
 if(req.method!=='POST')return reply('METHOD_NOT_ALLOWED',405);
 const secret=Deno.env.get('TRUCKY_SERVER_SECRET');
 if(!secret)return reply('UNAUTHORIZED',401);
 const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 const a=await digest(req.headers.get('authorization')||''),b=await digest(`Bearer ${secret}`);
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 if(diff)return reply('UNAUTHORIZED',401);
 const key=Deno.env.get('STRIPE_LIVE_SECRET_KEY');
 if(!key || !/^(sk|rk)_live_.+/.test(key || ''))return reply('LIVE_KEY_REQUIRED',503,{key_kind:key?String(key).slice(0,8).replace(/[^a-z_]/g,''):'missing'});
 try{
  const body=await req.json();
  if(!Array.isArray(body.prices)||body.prices.length!==2||body.prices[0]===body.prices[1])return reply('PRICES_REQUIRED',400,{is_array:Array.isArray(body?.prices),count:Array.isArray(body?.prices)?body.prices.length:null,same:Array.isArray(body?.prices)&&body.prices[0]===body.prices[1]});

  // El monto lo decide Stripe (tickets 91/100): aquí solo se valida que sea un precio
  // real, activo, en dólares y mensual.
  for(let i=0;i<body.prices.length;i++){
   const id=body.prices[i];
   if(typeof id!=='string'||!/^price_[a-zA-Z0-9]+$/.test(id))return reply('INVALID_PRICE',400,{price_index:i,type:typeof id,length:String(id).length,has_spaces:/\s/.test(String(id)),starts_ok:String(id).startsWith('price_')});
   let r:Response;
   try{
    r=await fetch(`https://api.stripe.com/v1/prices/${id}`,{redirect:'manual',headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(12000)});
   }catch(e){return reply('STRIPE_UNREACHABLE',503,{price_index:i,error:String((e as Error)?.name||'fetch_error')});}
   if(!r.ok){
    // El mensaje de Stripe no contiene llaves (ej. "No such price… a similar object exists in test mode").
    const err=await r.json().catch(()=>({}));
    const info={price_index:i,price_id:id,stripe_status:r.status,stripe_code:err?.error?.code??null,stripe_message:String(err?.error?.message??'').slice(0,200)};
    if(r.status===404)return reply('LIVE_PRICE_NOT_FOUND',400,info);   // no existe en la cuenta de esta llave (o es de modo prueba)
    if(r.status===401)return reply('LIVE_KEY_INVALID',503,info);       // llave inválida o revocada
    if(r.status===403)return reply('LIVE_KEY_PERMISSION',503,info);    // la llave no puede leer precios
    return reply('STRIPE_UNREACHABLE',503,info);
   }
   const price=await r.json();
   if(!price.livemode||!price.active||price.currency!=='usd'||!(Number.isSafeInteger(price.unit_amount)&&(price.unit_amount??0)>0)||price.type!=='recurring'||price.recurring?.interval!=='month'||price.recurring.interval_count!==1||price.billing_scheme!=='per_unit')return reply('LIVE_PRICE_MISMATCH',409,{price_index:i,livemode:price.livemode,active:price.active,currency:price.currency,unit_amount:price.unit_amount,type:price.type,interval:price.recurring?.interval??null,interval_count:price.recurring?.interval_count??null,billing_scheme:price.billing_scheme});
  }
  return reply('LIVE_CONFIGURATION_VALID');
 }catch(e){return reply('LIVE_CONFIGURATION_UNAVAILABLE',503,{error:String((e as Error)?.name||'error')});}
}
