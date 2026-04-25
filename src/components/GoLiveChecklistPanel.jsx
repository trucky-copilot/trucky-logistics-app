/**
 * GoLiveChecklistPanel
 * ─────────────────────
 * Panel visual que muestra el progreso de activación del workspace.
 * Se usa dentro de la pantalla de Onboarding cuando el estado es 'setup'.
 */

import { CheckCircle2, Circle, AlertCircle, Clock, Rocket } from 'lucide-react';
import { CHECKLIST_LABELS } from '@/lib/goLiveChecklist';

const STATUS_CONFIG = {
  not_ready: {
    label: 'No listo',
    color: 'text-red-400',
    bg: 'bg-red-400/10',
    border: 'border-red-400/20',
    icon: AlertCircle,
  },
  partially_ready: {
    label: 'Parcialmente listo',
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    border: 'border-yellow-400/20',
    icon: Clock,
  },
  ready_for_production: {
    label: 'Listo para producción',
    color: 'text-green-400',
    bg: 'bg-green-400/10',
    border: 'border-green-400/20',
    icon: Rocket,
  },
};

// Todos los ítems posibles en orden de importancia
const ALL_ITEMS = [
  'organization',
  'rol',
  'onboarding',
  'carrier_profile',
  'dispatcher_profile',
  'cost_config',
  'production_ready',
];

export default function GoLiveChecklistPanel({ setupDetails }) {
  if (!setupDetails) return null;

  const { missing = [], overall_status = 'not_ready', checklist = {} } = setupDetails;
  const statusCfg = STATUS_CONFIG[overall_status] || STATUS_CONFIG.not_ready;
  const StatusIcon = statusCfg.icon;

  const completedCount = ALL_ITEMS.filter(k => !missing.includes(k)).length;
  const totalCount = ALL_ITEMS.length;
  const progressPct = Math.round((completedCount / totalCount) * 100);

  return (
    <div className={`rounded-xl border ${statusCfg.border} ${statusCfg.bg} p-4 space-y-4`}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <StatusIcon className={`w-4 h-4 ${statusCfg.color} flex-shrink-0`} />
        <span className={`text-sm font-bold ${statusCfg.color}`}>{statusCfg.label}</span>
        <span className="ml-auto text-xs text-muted-foreground font-mono">
          {completedCount}/{totalCount}
        </span>
      </div>

      {/* Barra de progreso */}
      <div className="h-1.5 w-full bg-black/20 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            overall_status === 'ready_for_production' ? 'bg-green-400' :
            overall_status === 'partially_ready'      ? 'bg-yellow-400' :
                                                         'bg-red-400'
          }`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Lista de ítems */}
      <ul className="space-y-2">
        {ALL_ITEMS.map(key => {
          const isDone = !missing.includes(key);
          return (
            <li key={key} className="flex items-start gap-2.5">
              {isDone
                ? <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                : <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              }
              <span className={`text-xs leading-snug ${isDone ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                {CHECKLIST_LABELS[key] || key}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Nota: qué queda */}
      {missing.length > 0 && (
        <p className="text-xs text-muted-foreground border-t border-white/5 pt-3 leading-relaxed">
          Completa los pasos pendientes para desbloquear el acceso completo a Trucky.
        </p>
      )}
    </div>
  );
}