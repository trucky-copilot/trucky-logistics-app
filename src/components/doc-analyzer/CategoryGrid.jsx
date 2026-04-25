import { useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';

const SEMAFORO = {
  verde:    { icon: CheckCircle2, color: 'text-green-400',  dot: 'bg-green-400',  border: 'border-green-400/20',  bg: 'bg-green-400/5',   label: 'OK' },
  amarillo: { icon: AlertTriangle, color: 'text-yellow-400', dot: 'bg-yellow-400', border: 'border-yellow-400/20', bg: 'bg-yellow-400/5',  label: 'Revisar' },
  rojo:     { icon: XCircle,       color: 'text-red-400',    dot: 'bg-red-400',    border: 'border-red-400/20',    bg: 'bg-red-400/5',     label: 'Crítico' },
};

// Extrae el hallazgo principal (primer ✓ o ❌ o ⚠)
function getPrincipalHallazgo(hallazgos = []) {
  const critico = hallazgos.find(h => h.startsWith('❌'));
  if (critico) return critico;
  const warn = hallazgos.find(h => h.startsWith('⚠'));
  if (warn) return warn;
  return hallazgos[0] || '';
}

// Limpia el emoji del hallazgo para mostrarlo limpio
function limpiarHallazgo(h) {
  return h.replace(/^[❌⚠✓ℹ]\s*/, '').replace(/^[!✓⚠]\s*/, '').trim();
}

function CategoryCard({ cat }) {
  const [expanded, setExpanded] = useState(false);
  const s = SEMAFORO[cat.semaforo] || SEMAFORO.amarillo;
  const Icon = s.icon;
  const principal = getPrincipalHallazgo(cat.hallazgos);
  const detalles = cat.hallazgos?.filter(h => h !== principal) || [];

  return (
    <div className={`rounded-xl border ${s.border} ${s.bg} transition-all`}>
      <button
        className="w-full flex items-center gap-3 p-3.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Semáforo */}
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.dot}`} />

        {/* Categoría + hallazgo principal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-foreground">{cat.categoria}</span>
            <span className={`text-[10px] font-bold ${s.color} hidden sm:inline`}>{s.label}</span>
          </div>
          {principal && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{limpiarHallazgo(principal)}</p>
          )}
        </div>

        {/* Toggle */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className={`text-[10px] font-bold sm:hidden ${s.color}`}>{s.label}</span>
          {detalles.length > 0
            ? expanded
              ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
              : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            : <div className="w-3.5" />
          }
        </div>
      </button>

      {expanded && detalles.length > 0 && (
        <div className="px-4 pb-3.5 space-y-1.5 border-t border-white/5 pt-3">
          {detalles.map((h, i) => (
            <div key={i} className="flex items-start gap-2">
              <Icon className={`w-3 h-3 ${s.color} mt-0.5 flex-shrink-0`} />
              <span className="text-xs text-foreground">{limpiarHallazgo(h)}</span>
            </div>
          ))}
          {cat.recomendacion && (
            <div className="mt-2 pt-2 border-t border-white/5 flex gap-2">
              <span className="text-primary text-xs font-bold flex-shrink-0">→</span>
              <p className="text-xs text-muted-foreground">{cat.recomendacion}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CategoryGrid({ categorias }) {
  if (!categorias?.length) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide px-0.5">Análisis por categoría</p>
      <div className="space-y-1.5">
        {categorias.map((cat, i) => (
          <CategoryCard key={i} cat={cat} />
        ))}
      </div>
    </div>
  );
}