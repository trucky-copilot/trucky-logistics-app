import { Trash2 } from 'lucide-react';

/**
 * Modal de confirmación para eliminar elementos (Camión, Conductor, Broker, Carga).
 * Sigue los estilos del diseño dark/glassmorphic de Trucky.
 */
export default function DeleteConfirmModal({
  isOpen,
  title,
  subtitle,
  onConfirm,
  onClose,
  confirmText = 'Eliminar',
  cancelText = 'Cancelar',
  loading = false,
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm p-6 text-center space-y-4 shadow-2xl">
        <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-400 mx-auto flex items-center justify-center">
          <Trash2 className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1 font-mono">{subtitle}</p>
          )}
        </div>
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-all shadow-lg shadow-red-500/20 disabled:opacity-50"
          >
            {loading ? '...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
