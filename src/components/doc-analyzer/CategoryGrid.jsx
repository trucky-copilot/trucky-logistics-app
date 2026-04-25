import { useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp, Info } from 'lucide-react';

const SEMAFORO = {
  verde:    { icon: CheckCircle2,  color: 'text-green-400',  dot: 'bg-green-400',  border: 'border-green-400/25', bg: 'bg-green-400/5',   label: 'OK',       labelBg: 'bg-green-400/10 text-green-400' },
  amarillo: { icon: AlertTriangle, color: 'text-yellow-400', dot: 'bg-yellow-400', border: 'border-yellow-400/25',bg: 'bg-yellow-400/5',  label: 'Revisar',  labelBg: 'bg-yellow-400/10 text-yellow-400' },
  rojo:     { icon: XCircle,       color: 'text-red-400',    dot: 'bg-red-400',    border: 'border-red-400/25',   bg: 'bg-red-400/5',     label: 'Crítico',  labelBg: 'bg-red-400/10 text-red-400' },
};

function getHallazgoIcon(h) {
  if (h.startsWith('❌')) return { Icon: XCircle, color: 'text-red-400' };
  if (h.startsWith('⚠')) return { Icon: AlertTriangle, color: 'text-yellow-400' };
  if (h.startsWith('✓')) return { Icon: CheckCircle2, color: 'text-green-400' };
  return { Icon: Info, color: 'text-muted-foreground' };
}

function limpiar(h) {
  return h.replace(/^[❌⚠✓ℹ!]\s*/, '').trim();
}

function getPrincipal(hallazgos = []) {
  return hallazgos.find(h => h.startsWith('❌'))
    || hallazgos.find(h => h.startsWith('⚠'))
    || hallazgos[0]
    || '';
}

// Renderiza los datos extraídos como pills
function DatosExtraidos({ datos }) {
  if (!datos) return null;
  const entries = Object.entries(datos).filter(([, v]) => v && v !== 'No especificado' && v !== 'No especificada' && v !== 'No encontrado' && v !== 'Ninguna' && v !== 'No mencionado' && v !== 'No requerido');
  if (!entries.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-white/5">
      {entries.map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1 text-[10px] bg-muted/60 border border-border rounded-md px-2 py-1 text-muted-foreground">
          <span className="font-medium text-foreground/70">{k.replace(/_/g, ' ')}:</span>
          <span className="font-semibold text-foreground truncate max-w-[120px]">{String(v)}</span>
        </span>
      ))}
    </div>
  );
}

function CategoryCard({ cat, index }) {
  const [expanded, setExpanded] = useState(false);
  const s = SEMAFORO[cat.semaforo] || SEMAFORO.amarillo;
  const principal = getPrincipal(cat.hallazgos);
  const resto = (cat.hallazgos || []).filter(h => h !== principal);

  return (
    <div className={`rounded-xl border ${s.border} ${s.bg} transition-all overflow-hidden`}>
      {/* Header — siempre visible */}
      <button
        className="w-full flex items-start gap-3 p-3.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Número + semáforo */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
          <div className={`w-2 h-2 rounded-full ${s.dot}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-foreground">{cat.categoria}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.labelBg}`}>{s.label}</span>
          </div>
          {principal && (
            <p className="text-xs text-foreground/70 mt-1 leading-snug">
              {limpiar(principal)}
            </p>
          )}
        </div>

        <div className="flex-shrink-0 pt-0.5">
          {resto.length > 0 || cat.datos_extraidos
            ? expanded
              ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
              : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            : <div className="w-3.5" />
          }
        </div>
      </button>

      {/* Expandido */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">
          {/* Hallazgos detallados */}
          {resto.length > 0 && (
            <div className="space-y-2">
              {resto.map((h, i) => {
                const { Icon, color } = getHallazgoIcon(h);
                return (
                  <div key={i} className="flex items-start gap-2">
                    <Icon className={`w-3 h-3 ${color} mt-0.5 flex-shrink-0`} />
                    <span className="text-xs text-foreground/80 leading-snug">{limpiar(h)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Datos extraídos */}
          <DatosExtraidos datos={cat.datos_extraidos} />

          {/* Recomendación */}
          {cat.recomendacion && (
            <div className="flex items-start gap-2 pt-1 border-t border-white/5">
              <span className={`text-xs font-black ${s.color} flex-shrink-0`}>→</span>
              <p className="text-xs text-muted-foreground leading-snug">{cat.recomendacion}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CategoryGrid({ categorias }) {
  if (!categorias?.length) return null;

  const rojos = categorias.filter(c => c.semaforo === 'rojo').length;
  const amarillos = categorias.filter(c => c.semaforo === 'amarillo').length;
  const verdes = categorias.filter(c => c.semaforo === 'verde').length;

  return (
    <div className="space-y-2">
      {/* Header con resumen de semáforos */}
      <div className="flex items-center justify-between px-0.5">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Análisis por categoría</p>
        <div className="flex items-center gap-2">
          {rojos > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />{rojos}
            </span>
          )}
          {amarillos > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-yellow-400">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />{amarillos}
            </span>
          )}
          {verdes > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />{verdes}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        {categorias.map((cat, i) => (
          <CategoryCard key={i} cat={cat} index={i + 1} />
        ))}
      </div>
    </div>
  );
}