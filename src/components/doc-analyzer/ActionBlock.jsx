import { CheckCircle2, AlertTriangle, XCircle, MessageSquare, FileText } from 'lucide-react';

const ACTIONS = {
  'Aceptar':                   { Icon: CheckCircle2,  color: 'text-green-400',  bg: 'bg-green-400/10',  border: 'border-green-400/30',  label: 'Aceptar',                   desc: 'El documento está dentro de parámetros operativos. Puede proceder.' },
  'Revisar antes de aceptar':  { Icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30', label: 'Revisar antes de aceptar',   desc: 'Confirma los puntos marcados con el broker antes de firmar.' },
  'Negociar':                  { Icon: MessageSquare, color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30', label: 'Negociar condiciones',        desc: 'Solicita ajustes en tarifa, cláusulas o términos antes de aceptar.' },
  'No aceptar hasta corregir': { Icon: XCircle,       color: 'text-red-400',    bg: 'bg-red-400/10',    border: 'border-red-400/30',    label: 'No aceptar hasta corregir',  desc: 'Hay errores críticos que deben resolverse antes de proceder.' },
  'FIRMAR':   { Icon: CheckCircle2,  color: 'text-green-400',  bg: 'bg-green-400/10',  border: 'border-green-400/30',  label: 'Aceptar',                   desc: 'El documento está dentro de parámetros operativos.' },
  'NEGOCIAR': { Icon: MessageSquare, color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30', label: 'Negociar condiciones',        desc: 'Solicita ajustes antes de aceptar.' },
  'RECHAZAR': { Icon: XCircle,       color: 'text-red-400',    bg: 'bg-red-400/10',    border: 'border-red-400/30',    label: 'No aceptar',                  desc: 'Hay errores críticos que deben resolverse.' },
};

export default function ActionBlock({ veredicto, puntos_negociar }) {
  const a = ACTIONS[veredicto] || ACTIONS['Negociar'];
  const { Icon } = a;

  return (
    <div className={`rounded-xl border ${a.border} ${a.bg} p-4 space-y-3`}>
      <div className="flex items-center gap-2.5">
        <Icon className={`w-5 h-5 ${a.color} flex-shrink-0`} />
        <div>
          <p className={`text-sm font-black ${a.color}`}>{a.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{a.desc}</p>
        </div>
      </div>

      {puntos_negociar?.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-white/5">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <FileText className="w-3 h-3" /> Puntos a atender
          </p>
          {puntos_negociar.slice(0, 4).map((p, i) => (
            <div key={i} className="flex gap-2">
              <span className={`text-xs font-bold ${a.color} flex-shrink-0`}>{i + 1}.</span>
              <span className="text-xs text-foreground">{p}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}