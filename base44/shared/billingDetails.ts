// F3-15 · Fase 4 — "Mi plan": método de pago, historial de cobros y cancelar.
// Reglas puras (sin red). Nunca se mezclan pruebas y real:
//  - real: Organization.stripe_live_subscription_id + STRIPE_LIVE_SECRET_KEY (sk_/rk_live_)
//  - pruebas: Organization.stripe_subscription_id + STRIPE_SECRET_KEY (solo sk_test_)
// Las llaves solo se leen en el servidor y nunca se devuelven al navegador.
export type BillingMode =
  | { mode: 'live'; key: string; subscriptionId: string; customerId: string | null }
  | { mode: 'test'; key: string; subscriptionId: string }
  | { mode: 'none'; reason: string };

const SUB_RE = /^sub_[A-Za-z0-9]+$/;

export function chooseBillingMode(org: any, env: { live?: string | null; test?: string | null }): BillingMode {
  const liveSub = org?.stripe_live_subscription_id;
  if (typeof liveSub === 'string' && liveSub) {
    if (!SUB_RE.test(liveSub)) return { mode: 'none', reason: 'LIVE_MAPPING_INVALID' };
    if (!env.live || !/^(sk|rk)_live_.+/.test(env.live)) return { mode: 'none', reason: 'LIVE_KEY_REQUIRED' };
    return { mode: 'live', key: env.live, subscriptionId: liveSub, customerId: org?.stripe_live_customer_id || null };
  }
  const testSub = org?.stripe_subscription_id;
  if (typeof testSub === 'string' && testSub) {
    if (!SUB_RE.test(testSub)) return { mode: 'none', reason: 'TEST_MAPPING_INVALID' };
    if (!env.test || !env.test.startsWith('sk_test_')) return { mode: 'none', reason: 'TEST_KEY_REQUIRED' };
    return { mode: 'test', key: env.test, subscriptionId: testSub };
  }
  return { mode: 'none', reason: 'NO_SUBSCRIPTION' };
}

const customerOf = (sub: any) => (typeof sub?.customer === 'string' ? sub.customer : sub?.customer?.id) || null;

/** La suscripción leída de Stripe debe ser de ESTA organización y del modo correcto. */
export function subscriptionBelongs(sub: any, org: any, m: BillingMode): boolean {
  if (!sub || m.mode === 'none' || sub.id !== m.subscriptionId) return false;
  if (m.mode === 'live') {
    if (sub.livemode !== true) return false;
    return !m.customerId || customerOf(sub) === m.customerId;
  }
  if (sub.livemode !== false) return false;
  return sub.metadata?.org_id === org?.id;
}

const iso = (s: unknown) => (typeof s === 'number' && s > 0 ? new Date(s * 1000).toISOString() : null);

export function cardView(pm: any) {
  const c = pm && typeof pm === 'object' ? pm.card : null;
  if (!c) return null;
  return { marca: String(c.brand || ''), ultimos4: String(c.last4 || ''), vence_mes: c.exp_month ?? null, vence_anio: c.exp_year ?? null };
}

export function subscriptionView(sub: any) {
  const item = sub?.items?.data?.[0];
  return {
    estado: sub?.status || null,
    fin_periodo: iso(sub?.current_period_end ?? item?.current_period_end),
    fin_prueba: iso(sub?.trial_end),
    cancela_al_final: sub?.cancel_at_period_end === true,
    cancela_el: iso(sub?.cancel_at),
  };
}

export function invoicesView(list: any[]) {
  return (list || []).filter((i) => i && i.status !== 'draft').slice(0, 24).map((i) => ({
    id: String(i.id || ''),
    fecha: iso(i.status_transitions?.paid_at) || iso(i.created),
    monto: typeof i.amount_paid === 'number' && i.status === 'paid' ? i.amount_paid / 100 : (typeof i.amount_due === 'number' ? i.amount_due / 100 : null),
    moneda: String(i.currency || 'usd').toUpperCase(),
    estado: String(i.status || ''),
    numero: i.number || null,
    ver_url: typeof i.hosted_invoice_url === 'string' && i.hosted_invoice_url.startsWith('https://') ? i.hosted_invoice_url : null,
    pdf_url: typeof i.invoice_pdf === 'string' && i.invoice_pdf.startsWith('https://') ? i.invoice_pdf : null,
  }));
}

/** Qué cambio de cancelación aplica. Cancelar = al final del período (reversible). */
export function cancelChange(action: string, sub: any): { ok: true; cancel_at_period_end: boolean } | { ok: false; status: number; error: string } {
  if (!['active', 'trialing', 'past_due'].includes(sub?.status)) return { ok: false, status: 409, error: 'La suscripción no está activa' };
  if (action === 'cancelar') {
    if (sub.cancel_at_period_end === true) return { ok: false, status: 409, error: 'La suscripción ya está programada para cancelarse' };
    return { ok: true, cancel_at_period_end: true };
  }
  if (action === 'reanudar') {
    if (sub.cancel_at_period_end !== true) return { ok: false, status: 409, error: 'La suscripción no tiene una cancelación programada' };
    return { ok: true, cancel_at_period_end: false };
  }
  return { ok: false, status: 400, error: 'Acción no válida' };
}
