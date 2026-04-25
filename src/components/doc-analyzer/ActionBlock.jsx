import { CheckCircle2, AlertTriangle, XCircle, MessageSquare, ChevronRight } from 'lucide-react';

const ACTIONS = {
  'Aceptar': {
    Icon: CheckCircle2,
    color: 'text-green-400',
    bg: 'bg-green-400/10',
    border: 'border-green-400/30',
    label: 'Aceptar',
    desc: 'El documento está dentro de parámetros. Puede proceder a firmar y operar.',
  },
  'Revisar antes de aceptar': {
    Icon: AlertTriangle,
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    border: 'border-yellow-400/30',
    label: 'Revisar antes de aceptar',
    desc: 'Confirma los puntos marcados con el broker antes de firmar.',
  },
  'Negociar': {
    Icon: MessageSquare,
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    border: 'border-yellow-400/30',
    label: 'Negociar condiciones',
    desc: 'Solicita ajustes en tarifa, cláusulas o términos antes de aceptar.',
  },
  'No aceptar hasta corregir': {
    Icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-400/10',
    border: 'border-red-400/30',
    label: 'No aceptar hasta corregir',
    desc: 'Hay errores críticos que deben resolverse antes de proceder.',
  },
  // Compatibilidad legado
  'FIRMAR':   { Icon: CheckCircle2,  color: 'text-green-400',  bg: 'bg-green-400/10',  border: 'border-green-400/30',  label: 'Aceptar',                  desc: 'El documento está dentro de parámetros.' },
  'NEGOCIAR': { Icon: MessageSquare, color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30', label: 'Negociar condiciones',       desc: 'Solicita ajustes antes de aceptar.' },
  'RECHAZAR': { Icon: XCircle,       color: 'text-red-400',    bg: 'bg-red-400/10',    border: 'border-red-400/30',    label: 'No aceptar hasta corregir',  desc: 'Hay errores críticos que deben resolverse.' },
};

export default function ActionBlock({ veredicto, puntos_negociar }) {
  const a = ACTIONS[veredicto] || ACTIONS['Negociar'];
  const { Icon } = a;

  // Filtrar solo puntos que tienen contenido real
  const puntos = (puntos_negociar || []).filter(Boolean).slice(0, 5);

  return (
    <div className={`rounded-xl border ${a.border} ${a.bg} overflow-hidden`}>
      {/* Acción principal */}
      <div className="flex items-center gap-3 p-4">
        <div className={`w-10 h-10 rounded-xl border ${a.border} bg-black/20 flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-5 h-5 ${a.color}`} />
        </div>
        <div>
          <p className={`text-sm font-black ${a.color}`}>{a.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{a.desc}</p>
        </div>
      </div>

      {/* Puntos de acción */}
      {puntos.length > 0 && (
        <div className="border-t border-white/5 px-4 pb-4 pt-3 space-y-2">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">
            Pasos a seguir
          </p>
          {puntos.map((p, i) => (
            <div key={i} className="flex items-start gap-2">
              <ChevronRight className={`w-3.5 h-3.5 ${a.color} flex-shrink-0 mt-0.5`} />
              <span className="text-xs text-foreground leading-snug">{p}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}