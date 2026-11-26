// Cuando no se pudo consultar el plan (error pasajero o límite de consultas), no se
// afirma que el demo venció: antes salía "Demo bloqueado" a cuentas que sí pagan.
import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';

export default function PlanCheckRetryScreen() {
  const { locale } = useLanguage();
  const en = locale === 'en';
  // Reintento automático a los 15 s (el servidor suele pedir esperar unos segundos).
  // Máximo 3 reintentos automáticos seguidos; después solo con el botón.
  useEffect(() => {
    let n = 0;
    try { n = Number(sessionStorage.getItem('trucky-plan-retry') || 0); } catch { /* nada */ }
    if (n >= 3) return;
    const t = setTimeout(() => {
      try { sessionStorage.setItem('trucky-plan-retry', String(n + 1)); } catch { /* nada */ }
      window.location.reload();
    }, 15000);
    return () => clearTimeout(t);
  }, []);
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-t-bg-deep">
      <section className="max-w-md w-full space-y-4 rounded-2xl border border-border bg-t-bg-surface p-6 text-center shadow-popover">
        <RefreshCw className="w-8 h-8 mx-auto text-t-text-accent animate-spin" style={{ animationDuration: '2.5s' }} />
        <h1 className="text-lg font-semibold text-foreground">{en ? 'Checking your plan…' : 'Verificando tu plan…'}</h1>
        <p className="text-sm text-muted-foreground">
          {en ? 'We could not confirm your plan right now. We will try again in a few seconds; your account and data are safe.'
              : 'No pudimos confirmar tu plan en este momento. Lo intentamos de nuevo en unos segundos; tu cuenta y tus datos están a salvo.'}
        </p>
        <button type="button" onClick={() => window.location.reload()}
          className="h-10 px-5 rounded-full bg-t-action-primary hover:bg-t-action-primary-hover text-sm font-semibold text-white">
          {en ? 'Try again now' : 'Reintentar ahora'}
        </button>
      </section>
    </main>
  );
}
