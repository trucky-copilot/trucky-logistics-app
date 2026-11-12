// F3-15 · Fase 4 — Mi plan: estado de la suscripción y fin del período gratis.
// Método de pago, historial de cobros y cancelar vienen de Stripe a través de
// la función manageMyBilling (las llaves nunca llegan al navegador).
// Cancelar es al final del período y se puede reanudar.
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, CreditCard, Receipt, XCircle, Sparkles, CalendarClock, AlertTriangle, RotateCcw, ExternalLink, FileDown } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useEffectivePlan } from '@/lib/LivePlanProvider';
import { useAppState } from '@/lib/AppStateContext';
import { planSummary } from '@/lib/planSummary';

const tx = (locale, es, en) => (locale === 'en' ? en : es);
const TONES = {
  green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  violet: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  red: 'bg-red-500/15 text-red-300 border-red-500/30',
};

function Row({ label, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 py-3 border-b border-border last:border-0">
      <span className="sm:w-56 text-xs font-medium text-muted-foreground">{label}</span>
      <span className="flex-1 text-sm text-foreground">{children}</span>
    </div>
  );
}

export default function PlanSection({ locale }) {
  const plan = useEffectivePlan();
  const { organization } = useAppState();
  if (plan.loading || plan.loadingTrial) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> {tx(locale, 'Cargando…', 'Loading…')}</div>;
  }
  const s = planSummary(plan, organization, locale);
  const fmt = (iso) => { try { return new Date(iso).toLocaleDateString(locale === 'en' ? 'en-US' : 'es-CO', { dateStyle: 'long' }); } catch { return iso; } };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-card/60 p-5">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <Sparkles className="w-5 h-5 text-primary" />
          <h3 className="text-base font-semibold text-foreground flex-1">{s.nombre}</h3>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${TONES[s.tono]}`}>{s.estado}</span>
        </div>
        <Row label={tx(locale, 'Tipo de cuenta', 'Account type')}>{s.tipo}</Row>
        {s.finPrueba && (
          <Row label={s.pruebaVencida ? tx(locale, 'El período gratis terminó el', 'Free period ended on') : tx(locale, 'El período gratis termina el', 'Free period ends on')}>
            <span className="inline-flex items-center gap-2"><CalendarClock className="w-4 h-4 text-muted-foreground" />{fmt(s.finPrueba)}
              {s.diasRestantes != null && !s.pruebaVencida && <span className="text-xs text-muted-foreground">({tx(locale, `faltan ${s.diasRestantes} días`, `${s.diasRestantes} days left`)})</span>}
            </span>
          </Row>
        )}
        {s.nota && <p className="text-xs text-muted-foreground pt-3">{s.nota}</p>}
      </section>

      <BillingDetails locale={locale} orgId={organization?.id || null} fmt={fmt} />
    </div>
  );
}

const errMsg = (e) => e?.response?.data?.error || '';
const STATUS = {
  paid: { es: 'Pagado', en: 'Paid', cls: 'text-emerald-300' },
  open: { es: 'Pendiente', en: 'Open', cls: 'text-amber-300' },
  void: { es: 'Anulado', en: 'Void', cls: 'text-muted-foreground' },
  uncollectible: { es: 'No cobrado', en: 'Uncollectible', cls: 'text-red-300' },
};
const money = (n, cur, locale) => { try { return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-CO', { style: 'currency', currency: cur || 'USD' }).format(n); } catch { return `$${n}`; } };

function Card({ icon: Icon, title, children }) {
  return (
    <section className="rounded-xl border border-border bg-card/60 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground flex-1">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function BillingDetails({ locale, orgId, fmt }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // 'cancelar' | 'reanudar'
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState(null);

  const load = useCallback(() => {
    if (!orgId) return;
    setError('');
    base44.functions.invoke('manageMyBilling', { organization_id: orgId, accion: 'detalle' })
      .then((r) => setData(r.data))
      .catch((e) => setError(e?.response?.status === 404 && !errMsg(e)
        ? tx(locale, 'La función manageMyBilling aún no está publicada en Base44.', 'The manageMyBilling function is not published in Base44 yet.')
        : errMsg(e) || tx(locale, 'No se pudo consultar la información de pagos.', 'Billing information could not be loaded.')));
  }, [orgId, locale]);
  useEffect(() => { load(); }, [load]);

  if (!orgId) return null;
  if (error) return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>;
  if (!data) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> {tx(locale, 'Consultando pagos…', 'Loading billing…')}</div>;
  if (data.modo === 'none') {
    return <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-border p-4">{tx(locale, 'Esta cuenta no tiene una suscripción de pago, así que no hay método de pago ni cobros para mostrar.', 'This account has no paid subscription, so there is no payment method or charges to show.')}</p>;
  }

  const sub = data.suscripcion || {};
  const pm = data.metodo_pago;
  const activa = ['active', 'trialing', 'past_due'].includes(sub.estado);

  const ejecutar = async () => {
    setBusy(true); setAviso(null);
    try {
      const r = await base44.functions.invoke('manageMyBilling', { organization_id: orgId, accion: confirm, confirmar: true });
      setData((d) => ({ ...d, suscripcion: r.data.suscripcion }));
      setAviso({ ok: true, msg: confirm === 'cancelar' ? tx(locale, 'Tu suscripción quedó programada para cancelarse.', 'Your subscription is scheduled to cancel.') : tx(locale, 'Tu suscripción sigue activa.', 'Your subscription remains active.') });
    } catch (e) {
      setAviso({ ok: false, msg: errMsg(e) || tx(locale, 'No se pudo completar el cambio.', 'The change could not be completed.') });
    } finally { setBusy(false); setConfirm(null); }
  };

  return (
    <div className="space-y-5">
      {data.modo === 'test' && <p className="text-xs text-amber-300">{tx(locale, 'Modo pruebas: estos datos vienen de Stripe en modo de pruebas.', 'Test mode: this data comes from Stripe test mode.')}</p>}

      <Card icon={CreditCard} title={tx(locale, 'Método de pago', 'Payment method')}>
        {pm ? (
          <p className="text-sm text-foreground"><span className="capitalize">{pm.marca}</span> •••• {pm.ultimos4}
            {pm.vence_mes && <span className="text-muted-foreground"> · {tx(locale, 'vence', 'expires')} {String(pm.vence_mes).padStart(2, '0')}/{pm.vence_anio}</span>}</p>
        ) : <p className="text-sm text-muted-foreground">{tx(locale, 'No hay una tarjeta registrada.', 'No card on file.')}</p>}
      </Card>

      <Card icon={Receipt} title={tx(locale, 'Historial de cobros', 'Billing history')}>
        {(data.cobros || []).length === 0 ? <p className="text-sm text-muted-foreground">{tx(locale, 'Aún no hay cobros.', 'No charges yet.')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 pr-3 font-medium">{tx(locale, 'Fecha', 'Date')}</th>
                <th className="py-2 pr-3 font-medium">{tx(locale, 'Monto', 'Amount')}</th>
                <th className="py-2 pr-3 font-medium">{tx(locale, 'Estado', 'Status')}</th>
                <th className="py-2 font-medium text-right">{tx(locale, 'Factura', 'Invoice')}</th>
              </tr></thead>
              <tbody>
                {data.cobros.map((c) => {
                  const st = STATUS[c.estado] || { es: c.estado, en: c.estado, cls: 'text-muted-foreground' };
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap">{c.fecha ? fmt(c.fecha) : '—'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{c.monto != null ? money(c.monto, c.moneda, locale) : '—'}</td>
                      <td className={`py-2 pr-3 ${st.cls}`}>{locale === 'en' ? st.en : st.es}</td>
                      <td className="py-2 text-right whitespace-nowrap space-x-3">
                        {c.ver_url && <a href={c.ver_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">{tx(locale, 'Ver', 'View')} <ExternalLink className="w-3 h-3" /></a>}
                        {c.pdf_url && <a href={c.pdf_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">PDF <FileDown className="w-3 h-3" /></a>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card icon={XCircle} title={tx(locale, 'Cancelar suscripción', 'Cancel subscription')}>
        {sub.cancela_al_final ? (
          <div className="space-y-3">
            <p className="text-sm text-amber-300">{tx(locale, `Tu suscripción se cancelará el ${fmt(sub.cancela_el || sub.fin_periodo)}. Hasta esa fecha sigues teniendo acceso.`, `Your subscription will cancel on ${fmt(sub.cancela_el || sub.fin_periodo)}. You keep access until then.`)}</p>
            {data.puede_cancelar && <button type="button" onClick={() => setConfirm('reanudar')} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted"><RotateCcw className="w-4 h-4" /> {tx(locale, 'Mantener mi suscripción', 'Keep my subscription')}</button>}
          </div>
        ) : activa ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{tx(locale, 'Si cancelas, no se te vuelve a cobrar y conservas el acceso hasta el final del período que ya pagaste.', 'If you cancel, you will not be charged again and you keep access until the end of the period you already paid.')}</p>
            {data.puede_cancelar
              ? <button type="button" onClick={() => setConfirm('cancelar')} className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10"><XCircle className="w-4 h-4" /> {tx(locale, 'Cancelar suscripción', 'Cancel subscription')}</button>
              : <p className="text-xs text-muted-foreground">{tx(locale, 'Solo el dueño o un administrador de la empresa puede cancelar.', 'Only the company owner or an admin can cancel.')}</p>}
          </div>
        ) : <p className="text-sm text-muted-foreground">{tx(locale, 'La suscripción no está activa.', 'The subscription is not active.')}</p>}
        {aviso && <p className={`text-sm ${aviso.ok ? 'text-emerald-400' : 'text-red-400'}`}>{aviso.msg}</p>}
      </Card>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="space-y-2">
                <h3 className="text-base font-semibold text-foreground">{confirm === 'cancelar' ? tx(locale, '¿Cancelar tu suscripción?', 'Cancel your subscription?') : tx(locale, '¿Mantener tu suscripción?', 'Keep your subscription?')}</h3>
                <p className="text-sm text-muted-foreground">{confirm === 'cancelar'
                  ? tx(locale, `No se te volverá a cobrar. Conservas el acceso hasta el ${fmt(sub.fin_periodo)}. Puedes reanudarla antes de esa fecha.`, `You won't be charged again. You keep access until ${fmt(sub.fin_periodo)}. You can resume it before that date.`)
                  : tx(locale, 'Se quita la cancelación programada y el plan se seguirá cobrando normalmente.', 'The scheduled cancellation is removed and the plan will keep being charged as usual.')}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirm(null)} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted">{tx(locale, 'Volver', 'Back')}</button>
              <button type="button" onClick={ejecutar} disabled={busy} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60 ${confirm === 'cancelar' ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} {confirm === 'cancelar' ? tx(locale, 'Sí, cancelar', 'Yes, cancel') : tx(locale, 'Sí, mantener', 'Yes, keep it')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
