import Stripe from 'npm:stripe@23.0.0';
export default async function checkLiveBillingConfiguration(req:Request,_ctx:unknown){
 const reply=(code:string,status=200)=>new Response(JSON.stringify({code}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='POST')return reply('METHOD_NOT_ALLOWED',405);
 const secret=Deno.env.get('TRUCKY_SERVER_SECRET');
 if(!secret)return reply('UNAUTHORIZED',401);
 const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 const a=await digest(req.headers.get('authorization')||''),b=await digest(`Bearer ${secret}`);
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 if(diff)return reply('UNAUTHORIZED',401);
 const key=Deno.env.get('STRIPE_LIVE_SECRET_KEY');
 if(!key || !/^(sk|rk)_live_.+/.test(key || ''))return reply('LIVE_KEY_REQUIRED',503);
 try{
  const body=await req.json();
  if(!Array.isArray(body.prices)||body.prices.length!==2||body.prices[0]===body.prices[1])return reply('PRICES_REQUIRED',400);
  const stripe=new Stripe(key);
  // El monto lo decide Stripe (tickets 91/100): aquí solo se valida que sea un precio
  // real, activo, en dólares y mensual.
  for(const id of body.prices){
   if(typeof id!=='string'||!/^price_[a-zA-Z0-9]+$/.test(id))return reply('INVALID_PRICE',400);
   const price=await stripe.prices.retrieve(id);
   if(!price.livemode||!price.active||price.currency!=='usd'||!(Number.isSafeInteger(price.unit_amount)&&(price.unit_amount??0)>0)||price.type!=='recurring'||price.recurring?.interval!=='month'||price.recurring.interval_count!==1||price.billing_scheme!=='per_unit')return reply('LIVE_PRICE_MISMATCH',409);
  }
  return reply('LIVE_CONFIGURATION_VALID');
 }catch{return reply('LIVE_CONFIGURATION_UNAVAILABLE',503);}
}
