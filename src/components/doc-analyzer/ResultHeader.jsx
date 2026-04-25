import { CheckCircle2, AlertTriangle, XCircle, FileText, FileCheck, History } from 'lucide-react';

const VEREDICTO_CONFIG = {
  'Aceptar':                   { color: 'text-green-400',  bg: 'bg-green-400/10',  border: 'border-green-400/30',  icon: CheckCircle2, label: 'ACEPTAR',                   riesgo: 'Bajo' },
  'Revisar antes de aceptar':  { color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30', icon: AlertTriangle, label: 'REVISAR',                   riesgo: 'Medio' },
  'Negociar':                  { color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30', icon: AlertTriangle, label: 'NEGOCIAR',                   riesgo: 'Medio' },
  'No aceptar hasta corregir': { color: 'text-red-400',    bg: 'bg-red-400/10',    border: 'border-red-400/30',    icon: XCircle,       label: 'NO ACEPTAR',                riesgo: 'Alto' },
  'FIRMAR':   { color: 'text-green-400',  bg: 'bg-green-400/10',  border: 'border-green-400/30',  icon: CheckCircle2,  label: 'ACEPTAR',    riesgo: 'Bajo' },
  'NEGOCIAR': { color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30', icon: AlertTriangle, label: 'NEGOCIAR',   riesgo: 'Medio' },
  'RECHAZAR': { color: 'text-red-400',    bg: 'bg-red-400/10',    border: 'border-red-400/30',    icon: XCircle,       label: 'NO ACEPTAR', riesgo: 'Alto' },
};

const RESUMEN_CORTO = {
  'Aceptar':                   'Documento correcto para operar',
  'Revisar antes de aceptar':  'Requiere revisión antes de aceptar',
  'Negociar':                  'Hay condiciones que deben ajustarse',
  'No aceptar hasta corregir': 'Hay inconsistencias importantes',
  'FIRMAR':   'Documento correcto para operar',
  'NEGOCIAR': 'Hay condiciones que deben ajustarse',
  'RECHAZAR': 'No aceptar hasta corregir los errores',
};

const DOC_LABEL = {
  rate_confirmation: 'Rate Confirmation',
  delivery_order: 'Delivery Order',
  otro: 'Documento',
};

export default function ResultHeader({ analysis, onLinkToLoad, cached }) {
  const v = VEREDICTO_CONFIG[analysis.veredicto] || VEREDICTO_CONFIG['Negociar'];
  const Icon = v.icon;
  const docLabel = DOC_LABEL[analysis.datos_extraidos?.tipo_documento] || analysis.datos_extraidos?.tipo_documento || 'Documento';
  const resumenCorto = RESUMEN_CORTO[analysis.veredicto] || analysis.resumen_ejecutivo;

  return (
    <div className={`rounded-2xl border ${v.border} ${v.bg} overflow-hidden`}>
      {/* Top bar con tipo de documento */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-black/10">
        <FileCheck className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-xs text-muted-foreground font-medium">{docLabel}</span>
        {cached && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full border border-primary/20">
            <History className="w-2.5 h-2.5" /> Resultado anterior
          </span>
        )}
        {analysis.confidence_score != null && (
          <>
            <span className="text-border mx-1">·</span>
            <span className="text-xs text-muted-foreground">Confianza <span className="font-semibold text-foreground">{analysis.confidence_score}%</span></span>
          </>
        )}
        {analysis.carrier_profile_used && (
          <>
            <span className="text-border mx-1">·</span>
            <span className="text-xs text-muted-foreground truncate">Carrier: <span className="font-semibold text-foreground">{analysis.carrier_profile_used}</span></span>
          </>
        )}
      </div>

      {/* Veredicto principal */}
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className={`w-14 h-14 rounded-2xl border-2 ${v.border} bg-black/20 flex items-center justify-center flex-shrink-0`}>
            <Icon className={`w-7 h-7 ${v.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-2xl font-black tracking-tight ${v.color}`}>{v.label}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${v.border} ${v.color} opacity-70`}>
                Riesgo {v.riesgo}
              </span>
            </div>
            <p className="text-sm font-semibold text-foreground mt-1">{resumenCorto}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{analysis.resumen_ejecutivo}</p>
          </div>
        </div>

        {/* Foco de análisis + acción */}
        <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-white/5 flex-wrap">
          {analysis.foco_analisis && (
            <p className="text-xs text-muted-foreground">{analysis.foco_analisis}</p>
          )}
          <button
            onClick={onLinkToLoad}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors flex-shrink-0"
          >
            <FileText className="w-3 h-3" />
            Registrar carga
          </button>
        </div>
      </div>
    </div>
  );
}