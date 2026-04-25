import { useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';

const SEMAFORO = {
  verde: { icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-400/8 border-green-400/20', dot: 'bg-green-400', label: 'OK' },
  amarillo: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-400/8 border-yellow-400/20', dot: 'bg-yellow-400', label: 'Revisar' },
  rojo: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-400/8 border-red-400/20', dot: 'bg-red-400', label: 'Crítico' },
};

export default function CategoryCard({ cat, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const config = SEMAFORO[cat.semaforo] || SEMAFORO.amarillo;
  const Icon = config.icon;

  return (
    <div className={`rounded-xl border ${config.bg} transition-all`}>
      <button
        className="w-full flex items-center gap-3 p-3.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Semáforo dot */}
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${config.dot}`} />

        <span className="flex-1 text-sm font-semibold text-foreground">{cat.categoria}</span>

        {/* Datos clave inline */}
        {cat.datos_extraidos && (
          <div className="hidden sm:flex items-center gap-1.5 flex-wrap justify-end max-w-[40%]">
            {Object.values(cat.datos_extraidos).filter(Boolean).slice(0, 2).map((val, i) => (
              <span key={i} className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded truncate max-w-[120px]">{val}</span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1.5 flex-shrink-0 ml-1">
          <span className={`text-xs font-bold ${config.color}`}>{config.label}</span>
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
            : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          }
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
          {/* Datos extraídos */}
          {cat.datos_extraidos && (
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(cat.datos_extraidos).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="bg-black/20 rounded-lg px-2.5 py-2">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{k.replace(/_/g, ' ')}</div>
                  <div className="text-xs text-foreground font-medium mt-0.5 truncate">{v}</div>
                </div>
              ))}
            </div>
          )}

          {/* Hallazgos */}
          {cat.hallazgos?.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1.5">Hallazgos</p>
              <ul className="space-y-1">
                {cat.hallazgos.map((h, i) => (
                  <li key={i} className="text-xs text-foreground flex gap-2">
                    <Icon className={`w-3 h-3 ${config.color} mt-0.5 flex-shrink-0`} />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recomendación */}
          {cat.recomendacion && (
            <div className="bg-black/20 rounded-lg p-2.5 flex gap-2">
              <span className="text-primary text-xs font-bold flex-shrink-0">→</span>
              <p className="text-xs text-foreground">{cat.recomendacion}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}