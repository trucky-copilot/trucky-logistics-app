// Tickets 91/100: el precio se cambia en Stripe sin reprogramar. El plan se
// reconoce por el ID de precio configurado (secreto), no por un monto fijo.
import test from 'node:test';import assert from 'node:assert/strict';
import {validateLivePlan} from '../../base44/shared/livePlanPolicy.ts';
import {planFromPrice} from '../../base44/shared/planFromPrice.ts';
const org={id:'org',active:true,stripe_live_subscription_id:'sub_real',stripe_live_customer_id:'cus_real'};
const prices={owner_op:'price_owner',fleet:'price_fleet'};
const base={livemode:true,currency:'usd',type:'recurring',recurring:{interval:'month',interval_count:1},billing_scheme:'per_unit'};
const sub=(price)=>({id:'sub_real',livemode:true,customer:'cus_real',metadata:{org_id:'org'},status:'active',trial_end:null,items:{data:[{quantity:1,price}]},latest_invoice:{billing_reason:'subscription_create',livemode:true,status:'paid',customer:'cus_real',subscription:'sub_real'}});

test('precio nuevo en Stripe ($35 / $129) con el ID configurado → se reconoce el plan', () => {
  assert.equal(validateLivePlan(org, sub({...base,id:'price_owner',unit_amount:3500}), prices).plan, 'plan_29');
  assert.equal(validateLivePlan(org, sub({...base,id:'price_fleet',unit_amount:12900}), prices).plan, 'plan_99');
});
test('un precio que NO es el configurado se rechaza aunque cueste $29', () => {
  assert.equal(validateLivePlan(org, sub({...base,id:'price_otro',unit_amount:2900}), prices).allowed, false);
});
test('monto 0 o inválido, otra moneda o cobro anual se siguen rechazando', () => {
  for (const p of [{unit_amount:0},{unit_amount:null},{currency:'eur',unit_amount:2900},{recurring:{interval:'year',interval_count:1},unit_amount:2900}])
    assert.equal(validateLivePlan(org, sub({...base,id:'price_owner',...p}), prices).allowed, false);
});
test('un pago fallido (factura abierta / suscripción incompleta) no activa nada aunque el precio sea válido', () => {
  const s = sub({...base,id:'price_owner',unit_amount:3500});
  assert.equal(validateLivePlan(org, {...s, latest_invoice:{...s.latest_invoice,status:'open'}}, prices).allowed, false);
  for (const status of ['incomplete','past_due','unpaid']) assert.equal(validateLivePlan(org, {...s,status}, prices).allowed, false);
});
test('planFromPrice: por ID configurado, o por metadata trucky_plan; nunca por monto', () => {
  assert.equal(planFromPrice({id:'price_owner',unit_amount:9900}, prices), 'plan_29');
  assert.equal(planFromPrice({id:'price_x',unit_amount:2900}, prices), null);
  assert.equal(planFromPrice({id:'price_x',metadata:{trucky_plan:'plan_99'}}, prices), 'plan_99');
  assert.equal(planFromPrice({id:'price_x',metadata:{trucky_plan:'plan_500'}}, {}), null);
});
