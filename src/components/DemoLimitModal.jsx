import { Sparkles, X, ShieldAlert } from 'lucide-react';

export default function DemoLimitModal({
  isOpen,
  onClose,
  title,
  message,
  currentCount,
  maxLimit,
  entityName,
  limit,
}) {
  if (!isOpen) return null;

  const effectiveLimit = maxLimit ?? limit ?? 3;
  const entityLabel = entityName ? ` ${entityName}` : ' elementos';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-md p-6 overflow-hidden border rounded-3xl bg-card border-border shadow-2xl text-center space-y-4">
        {/* Glow decoration */}
        <div className="absolute -top-12 -left-12 w-32 h-32 bg-primary/20 rounded-full blur-3xl pointer-events-none" />

        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="w-12 h-12 mx-auto rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-inner">
          <ShieldAlert className="w-6 h-6" />
        </div>

        <div className="space-y-1.5">
          <h3 className="text-lg font-bold text-foreground">
            {title || 'Límite alcanzado'}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {message || `Has alcanzado el límite máximo de ${effectiveLimit}${entityLabel} permitidos en tu plan actual.`}
          </p>
        </div>

        {currentCount !== undefined && effectiveLimit !== undefined && (
          <div className="py-2 px-3 rounded-xl bg-muted/50 border border-border text-xs text-muted-foreground flex items-center justify-between">
            <span>Uso actual:</span>
            <span className="font-semibold text-foreground">{currentCount} de {effectiveLimit} permitidos</span>
          </div>
        )}

        <div className="pt-2 space-y-2">
          <a
            href="https://trucky.site"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3 px-4 rounded-xl font-bold text-xs bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-lg shadow-violet-500/25 flex items-center justify-center gap-2 transition-all hover:scale-[1.01]"
          >
            <Sparkles className="w-4 h-4" />
            <span>Actualizar plan en trucky.site →</span>
          </a>

          <button
            onClick={onClose}
            className="w-full py-2 px-4 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
