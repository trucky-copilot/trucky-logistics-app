import { CheckCircle2, AlertTriangle, XCircle, Package } from 'lucide-react';

const VEREDICTO_CONFIG = {
  FIRMAR:   { color: 'text-green-400',  bg: 'bg-green-400/10 border-green-400/30',  icon: CheckCircle2,  label: 'PUEDE FIRMAR',    sublabel: 'Documento dentro de parámetros' },
  NEGOCIAR: { color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/30', icon: AlertTriangle, label: 'NEGOCIAR ANTES',  sublabel: 'Revisar puntos antes de aceptar' },
  RECHAZAR: { color: 'text-red-400',    bg: 'bg-red-400/10 border-red-400/30',       icon: XCircle,       label: 'RECHAZAR',        sublabel: 'Riesgos inaceptables detectados' },
};

const ROL_LABEL = {
  carrier: 'Análisis Carrier',
  dispatcher: 'Análisis Dispatcher',
  ambos: 'Análisis Operativo',
};

export default function VeredictoCard({ analysis, onLinkToLoad }) {
  const v = VEREDICTO_CONFIG[analysis.veredicto] || VEREDICTO_CONFIG.NEGOCIAR;
  const Icon = v.icon;
  const rojos = analysis.categorias?.filter(c => c.semaforo === 'rojo').length || 0;
  const amarillos = analysis.categorias?.filter(c => c.semaforo === 'amarillo').length || 0;

  return (
    <div className={`rounded-2xl border p-5 ${v.bg}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl border-2 ${v.bg} flex items-center justify-center flex-shrink-0`}>
            <Icon className={`w-6 h-6 ${v.color}`} />
          </div>
          <div>
            <div className={`text-xl font-black tracking-tight ${v.color}`}>{v.label}</div>
            <div className="text-xs text-muted-foreground">{ROL_LABEL[analysis.user_role] || 'Análisis Operativo'}</div>
          </div>
        </div>

        {/* Semáforo resumen */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            {rojos > 0 && <span className="text-xs font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">{rojos} crítico{rojos > 1 ? 's' : ''}</span>}
            {amarillos > 0 && <span className="text-xs font-bold text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full">{amarillos} revisar</span>}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {analysis.confidence_score != null && (
              <div className="text-[10px] text-muted-foreground">
                Confianza: <span className="font-bold text-foreground">{analysis.confidence_score}%</span>
              </div>
            )}
            <button
              onClick={onLinkToLoad}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
            >
              <Package className="w-3 h-3" />
              Registrar carga
            </button>
          </div>
        </div>
      </div>

      <p className="text-sm text-foreground leading-relaxed">{analysis.resumen_ejecutivo}</p>
    </div>
  );
}