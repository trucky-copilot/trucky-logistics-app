// Pago en curso: se muestra mientras Stripe confirma el pago y la cuenta se
// activa (getMyPlan → checkoutPending). La app vuelve a consultar cada 10 s y
// entra sola cuando el plan queda activo. No da acceso: solo informa.
import { Loader2, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';

export default function ActivatingAccountScreen() {
  const { logout } = useAuth();
  const { locale } = useLanguage();
  const en = locale === 'en';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background p-4 font-inter">
      <div role="status" aria-live="polite" className="max-w-md w-full bg-card border border-border rounded-2xl p-6 sm:p-8 text-center shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-5">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">
          {en ? 'We are activating your account…' : 'Estamos activando tu cuenta…'}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          {en
            ? 'We received your payment. Activation usually takes a few seconds; this page updates by itself.'
            : 'Recibimos tu pago. La activación suele tardar unos segundos; esta página se actualiza sola.'}
        </p>
        <p className="text-xs text-muted-foreground/80 leading-relaxed mb-6">
          {en
            ? 'If it is not active in 15 minutes, do not pay again: contact us at www.trucky-ai.com with the email you paid with.'
            : 'Si en 15 minutos no se activa, no vuelvas a pagar: escríbenos desde www.trucky-ai.com con el correo con el que pagaste.'}
        </p>
        <button
          type="button"
          onClick={() => logout()}
          className="w-full h-10 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/70 transition-colors inline-flex items-center justify-center gap-2"
        >
          <LogOut className="w-4 h-4" /> {en ? 'Sign out' : 'Cerrar sesión'}
        </button>
      </div>
    </div>
  );
}
