import { ShieldAlert, ExternalLink, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

export default function DemoExpiredScreen({ reason }) {
  const { logout, user } = useAuth();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-md p-4 font-inter">
      <div className="max-w-md w-full bg-card border border-border rounded-2xl p-6 sm:p-8 text-center shadow-2xl relative overflow-hidden">
        {/* Glow decoration */}
        <div className="absolute -top-12 -left-12 w-32 h-32 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />

        <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center mx-auto mb-5 shadow-inner">
          <ShieldAlert className="w-7 h-7" />
        </div>

        <h2 className="text-xl font-bold text-foreground mb-2">
          {reason === 'no_trial' ? 'Acceso Requiere Periodo Demo Activo' : 'Tu Periodo Demo Ha Finalizado'}
        </h2>

        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          {reason === 'no_trial'
            ? 'Tu cuenta no cuenta con un registro de demo trial activo para ingresar a la plataforma.'
            : 'Los días de tu prueba gratuita han concluido. Para continuar disfrutando de todas las herramientas de Trucky, suscríbete al plan completo.'}
        </p>

        <div className="space-y-3">
          <a
            href="https://trucky.site"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3 px-4 rounded-xl font-semibold text-sm bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-lg shadow-violet-500/25 flex items-center justify-center gap-2 transition-all"
          >
            <span>Activar versión completa en trucky.site</span>
            <ExternalLink className="w-4 h-4" />
          </a>

          <button
            onClick={() => {
              // Limpiar absolutamente todas las credenciales locales y recargar inmediatamente en la misma URL (Welcome)
              try {
                localStorage.removeItem('base44_access_token');
                localStorage.removeItem('token');
                localStorage.removeItem('base44_token');
                localStorage.removeItem('base44_user_id');
                localStorage.removeItem('base44_app_id');
                sessionStorage.clear();
              } catch (_) {}
              logout(false);
              // Mantener la misma URL local (/ o /welcome) y recargar limpio
              window.location.replace('/');
            }}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 hover:border-zinc-600 transition-all flex items-center justify-center gap-2 shadow-sm"
          >
            <LogOut className="w-3.5 h-3.5 text-zinc-400" />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </div>
    </div>
  );
}
