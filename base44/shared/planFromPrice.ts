// Tickets 91/100: de qué plan es un precio de Stripe, SIN mirar el monto.
// 1) Por ID de precio configurado en los secretos (el camino normal).
// 2) Si el precio no está configurado, por su metadata `trucky_plan`
//    (plan_29 | plan_99), que se pone al crear el precio en Stripe.
// Así cambiar el precio en Stripe no exige reprogramar: se crea el precio nuevo
// y se actualiza el secreto (o se le pone la metadata).
export type PaidPlanType = 'plan_29' | 'plan_99';

export function planFromPrice(price: any, ids: { owner_op?: string | null; fleet?: string | null }): PaidPlanType | null {
  const id = typeof price?.id === 'string' ? price.id : null;
  if (!id) return null;
  if (ids.owner_op && id === ids.owner_op) return 'plan_29';
  if (ids.fleet && id === ids.fleet) return 'plan_99';
  const meta = price?.metadata?.trucky_plan;
  return meta === 'plan_29' || meta === 'plan_99' ? meta : null;
}
