// F3-15 · Invita y gana — PM-03: bono de la Academia (primer mes del plan de $29 gratis).
// El código se usa en la página de pago de trucky-ai.com, que lo valida en Stripe y
// permite usarlo una sola vez por cuenta. Aquí solo se muestra, se copia y se comparte.
// PM-03 · Código de referido: cada usuario tiene su enlace de invitación personal;
// quien se registra con él queda vinculado (UserProfile.invitado_por).
import React, { useEffect, useState } from 'react';
import { Gift, Copy, Check, ExternalLink, Share2, CheckCircle2, Link2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useEffectivePlan } from '@/lib/LivePlanProvider';
import { ACADEMY_CODE, ACADEMY_URL } from '@/lib/support';
import { nuevoCodigo, normalizarCodigo, enlaceInvitacion } from '@/lib/invite';

const tx = (locale, es, en) => (locale === 'en' ? en : es);

export default function InviteSection({ locale }) {
  const plan = useEffectivePlan();
  const { user } = useAuth();
  const email = String(user?.email || '').toLowerCase();
  const [copiado, setCopiado] = useState(null);
  const [codigo, setCodigo] = useState(null);

  // Código personal: se lee del perfil o se crea la primera vez.
  useEffect(() => {
    let activo = true;
    if (!email) return;
    (async () => {
      try {
        const rows = await base44.entities.UserProfile.filter({ usuario: email });
        const rec = rows?.[0];
        let c = normalizarCodigo(rec?.codigo_invitacion);
        if (!c) {
          c = nuevoCodigo();
          if (rec) await base44.entities.UserProfile.update(rec.id, { codigo_invitacion: c });
          else await base44.entities.UserProfile.create({ usuario: email, codigo_invitacion: c });
        }
        if (activo) setCodigo(c);
      } catch { /* sin perfil: se comparte solo el código de la Academia */ }
    })();
    return () => { activo = false; };
  }, [email]);

  const enlace = codigo ? enlaceInvitacion(codigo) : ACADEMY_URL;
  const conPlan = plan.planType === 'plan_29' || plan.planType === 'plan_99' || plan.planType === 'admin';

  const mensaje = tx(locale,
    `Te recomiendo Trucky, el copiloto para dispatchers. Con el código ${ACADEMY_CODE} de la Academia tienes el primer mes del plan de $29 gratis. Crea tu cuenta aquí: ${enlace}`,
    `I recommend Trucky, the copilot for dispatchers. With the Academy code ${ACADEMY_CODE} you get the first month of the $29 plan free. Create your account here: ${enlace}`);

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
            <p className="text-xs text-muted-foreground mt-0.5">{tx(locale, 'Envíales tu enlace de invitación. Al registrarse con él quedan vinculados a tu cuenta y usan el código al pagar.', 'Send them your invitation link. When they sign up with it they are linked to your account and use the code at checkout.')}</p>
          </div>
        </div>
        {codigo && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-t-bg-input border border-border px-3 py-2">
            <span className="text-sm text-foreground truncate">{enlace}</span>
            <button type="button" onClick={() => copiar(enlace, 'enlace')}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted">
              {copiado === 'enlace' ? <Check className="w-3.5 h-3.5 text-t-success" /> : <Link2 className="w-3.5 h-3.5" />}
              {copiado === 'enlace' ? tx(locale, 'Copiado', 'Copied') : tx(locale, 'Copiar enlace', 'Copy link')}
            </button>
          </div>
        )}
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
