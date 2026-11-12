// F3-15 · Fase 4 — Resumen legible del plan para "Mi plan". Función pura:
// recibe el plan efectivo (useEffectivePlan) y la organización, y devuelve
// textos y fechas. No autoriza nada; el servidor sigue decidiendo el acceso.
const tx = (locale, es, en) => (locale === 'en' ? en : es);
const DAY = 86400000;

export function planSummary(plan = {}, org = null, locale = 'es', now = Date.now()) {
  const p = plan.planType || 'demo';
  const tipo = { carrier: 'Carrier', dispatcher: 'Dispatcher', ambos: tx(locale, 'Carrier y dispatcher', 'Carrier and dispatcher') }[org?.account_type] || '—';
  const dias = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? null : Math.max(0, Math.ceil((t - now) / DAY)); };
  const vencida = (iso) => { const t = Date.parse(iso); return !Number.isNaN(t) && t <= now; };

  if (p === 'admin') {
    return { nombre: tx(locale, 'Cuenta de administrador', 'Administrator account'), estado: tx(locale, 'Activa', 'Active'), tono: 'green', tipo, finPrueba: null };
  }

  if (p === 'plan_29' || p === 'plan_99') {
    const nombre = p === 'plan_99' ? tx(locale, 'Plan $99 / mes', '$99 / month plan') : tx(locale, 'Plan $29 / mes', '$29 / month plan');
    const st = org?.subscription_status;
    const base = { nombre, tipo, finPrueba: null };
    if (st === 'trialing') {
      const fin = org?.trial_ends_at || null;
      return { ...base, estado: tx(locale, 'Período gratis', 'Free period'), tono: 'amber', finPrueba: fin, diasRestantes: fin ? dias(fin) : null, pruebaVencida: fin ? vencida(fin) : false,
        nota: tx(locale, 'Al terminar el período gratis se empieza a cobrar el plan.', 'When the free period ends, the plan starts being charged.') };
    }
    if (st === 'past_due' || st === 'unpaid') {
      return { ...base, estado: tx(locale, 'Pago pendiente', 'Payment due'), tono: 'red',
        nota: tx(locale, 'No se pudo cobrar el último pago. Revisa tu método de pago.', 'The last payment could not be charged. Check your payment method.') };
    }
    return { ...base, estado: tx(locale, 'Activa', 'Active'), tono: 'green' };
  }

  // Cuenta de demostración (sin suscripción pagada).
  const t = plan.trialData || {};
  const fin = t.trialEndsAt || null;
  const expirada = t.hasTrial ? (t.isExpired === true || (fin ? vencida(fin) : false)) : true;
  return {
    nombre: tx(locale, 'Cuenta de demostración', 'Demo account'),
    estado: expirada ? tx(locale, 'Demo · prueba vencida', 'Demo · trial ended') : 'Demo',
    tono: expirada ? 'red' : 'violet',
    tipo,
    finPrueba: fin,
    diasRestantes: fin ? dias(fin) : null,
    pruebaVencida: expirada,
    nota: tx(locale, 'Las cuentas de demostración ven datos de ejemplo y tienen funciones limitadas.', 'Demo accounts see sample data and have limited features.'),
  };
}
