import { CheckCircle2, AlertTriangle, XCircle, MessageSquare, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';

export default function ActionBlock({ veredicto, puntos_negociar }) {
  const { t, locale } = useLanguage();

  const ACTIONS = {
    'Aceptar': { Icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/30', label: locale === 'en' ? 'Accept' : 'Aceptar', desc: locale === 'en' ? 'The document is within parameters. You may proceed.' : 'El documento está dentro de parámetros. Puede proceder a firmar y operar.' },
    'Accept': { Icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/30', label: locale === 'en' ? 'Accept' : 'Aceptar', desc: locale === 'en' ? 'The document is within parameters. You may proceed.' : 'El documento está dentro de parámetros. Puede proceder a firmar y operar.' },
    'Revisar antes de aceptar': { Icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30', label: locale === 'en' ? 'Review before accepting' : 'Revisar antes de aceptar', desc: locale === 'en' ? 'Confirm the flagged points with the broker before signing.' : 'Confirma los puntos marcados con el broker antes de firmar.' },
    'Review before accepting': { Icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30', label: locale === 'en' ? 'Review before accepting' : 'Revisar antes de aceptar', desc: locale === 'en' ? 'Confirm the flagged points with the broker before signing.' : 'Confirma los puntos marcados con el broker antes de firmar.' },
    'Negociar': { Icon: MessageSquare, color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30', label: locale === 'en' ? 'Negotiate conditions' : 'Negociar condiciones', desc: locale === 'en' ? 'Request adjustments to rate, clauses, or terms before accepting.' : 'Solicita ajustes en tarifa, cláusulas o términos antes de aceptar.' },
    'Negotiate': { Icon: MessageSquare, color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30', label: locale === 'en' ? 'Negotiate conditions' : 'Negociar condiciones', desc: locale === 'en' ? 'Request adjustments to rate, clauses, or terms before accepting.' : 'Solicita ajustes en tarifa, cláusulas o términos antes de aceptar.' },
    'No aceptar hasta corregir': { Icon: XCircle, color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/30', label: locale === 'en' ? 'Do not accept until corrected' : 'No aceptar hasta corregir', desc: locale === 'en' ? 'There are critical errors that must be resolved before proceeding.' : 'Hay errores críticos que deben resolverse antes de proceder.' },
    'Do not accept until corrected': { Icon: XCircle, color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/30', label: locale === 'en' ? 'Do not accept until corrected' : 'No aceptar hasta corregir', desc: locale === 'en' ? 'There are critical errors that must be resolved before proceeding.' : 'Hay errores críticos que deben resolverse antes de proceder.' },
  };

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
            {t.documents.stepsToFollow}
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