// F3-15 · Invita y gana — PM-03: bono de la Academia (primer mes del plan de $29 gratis).
// El código se usa en la página de pago de trucky-ai.com, que lo valida en Stripe y
// permite usarlo una sola vez por cuenta. Aquí solo se muestra, se copia y se comparte.
import React, { useState } from 'react';
import { Gift, Copy, Check, ExternalLink, Share2, CheckCircle2 } from 'lucide-react';
import { useEffectivePlan } from '@/lib/LivePlanProvider';
import { ACADEMY_CODE, ACADEMY_URL } from '@/lib/support';

const tx = (locale, es, en) => (locale === 'en' ? en : es);

export default function InviteSection({ locale }) {
  const plan = useEffectivePlan();
  const [copiado, setCopiado] = useState(null);
  const conPlan = plan.planType === 'plan_29' || plan.planType === 'plan_99' || plan.planType === 'admin';

  const mensaje = tx(locale,
    `Te recomiendo Trucky, el copiloto para dispatchers. Con el código ${ACADEMY_CODE} de la Academia tienes el primer mes del plan de $29 gratis: ${ACADEMY_URL}`,
    `I recommend Trucky, the copilot for dispatchers. With the Academy code ${ACADEMY_CODE} you get the first month of the $29 plan free: ${ACADEMY_URL}`);

  const copiar = async (texto, cual) => {
    try { await navigator.clipboard.writeText(texto); setCopiado(cual); setTimeout(() => setCopiado(null), 2000); } catch { /* sin portapapeles */ }
  };
  const compartir = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'Trucky', text: mensaje }); return; } catch { /* cancelado */ } }
    copiar(mensaje, 'mensaje');
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Gift className="w-5 h-5 text-t-accent-lime mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">{tx(locale, 'Bono de la Academia', 'Academy bonus')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tx(locale,
                'El primer mes del plan de $29 es gratis. Desde el segundo mes se cobra $29/mes normal y puedes cancelar cuando quieras. Se usa una sola vez por cuenta.',
                'The first month of the $29 plan is free. From the second month it is charged $29/month as usual and you can cancel anytime. It can be used once per account.')}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 flex items-center justify-between gap-3 rounded-xl border border-dashed border-t-border-strong bg-t-bg-input px-4 py-3">
            <span className="font-mono text-lg font-bold tracking-[0.2em] text-foreground">{ACADEMY_CODE}</span>
            <button type="button" onClick={() => copiar(ACADEMY_CODE, 'codigo')}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted">
              {copiado === 'codigo' ? <Check className="w-3.5 h-3.5 text-t-success" /> : <Copy className="w-3.5 h-3.5" />}
              {copiado === 'codigo' ? tx(locale, 'Copiado', 'Copied') : tx(locale, 'Copiar código', 'Copy code')}
            </button>
          </div>
        </div>

        {conPlan ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="w-4 h-4 text-t-success" />
            {tx(locale, 'Tu cuenta ya tiene un plan activo. Comparte el código con otros dispatchers de la Academia.', 'Your account already has an active plan. Share the code with other Academy dispatchers.')}
          </p>
        ) : (
          <a href={ACADEMY_URL} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full bg-t-action-primary hover:bg-t-action-primary-hover text-sm font-semibold text-white">
            {tx(locale, 'Usar el bono en trucky-ai.com', 'Use the bonus at trucky-ai.com')} <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-start gap-3">
          <Share2 className="w-5 h-5 text-t-text-accent mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">{tx(locale, 'Invita a otros dispatchers', 'Invite other dispatchers')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{tx(locale, 'Envíales este mensaje con el código.', 'Send them this message with the code.')}</p>
          </div>
        </div>
        <p className="text-sm text-foreground rounded-lg bg-t-bg-input border border-border px-3 py-2">{mensaje}</p>
        <button type="button" onClick={compartir}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs text-foreground hover:bg-muted">
          {copiado === 'mensaje' ? <Check className="w-3.5 h-3.5 text-t-success" /> : <Share2 className="w-3.5 h-3.5" />}
          {copiado === 'mensaje' ? tx(locale, 'Mensaje copiado', 'Message copied') : tx(locale, 'Compartir', 'Share')}
        </button>
      </section>
    </div>
  );
}
