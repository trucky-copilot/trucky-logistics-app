import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

// Figma · KPI Tile / KPI Card: superficie plana, ícono en bg/surface-raised,
// chip de variación (verde/rojo suave) y valor en estilo Data/KPI.
const ICON_TONE = {
  violet: 'text-t-text-accent',
  cyan: 'text-t-accent-cyan',
  green: 'text-t-success',
  red: 'text-t-danger',
  yellow: 'text-t-warning',
};

export default function KpiCard({
  titulo,
  valor,
  subtitulo,
  trend = null,
  trendLabel = null,
  color = 'violet',
  icon: Icon,
}) {
  const chip = trend > 0
    ? 'bg-t-accent-lime/15 text-t-accent-lime' // acento lima de la identidad Trucky
    : trend < 0
      ? 'bg-t-danger-soft text-t-danger'
      : 'bg-t-action-secondary text-t-text-secondary';

  return (
    <div className="rounded-2xl border border-border bg-t-bg-surface p-5 flex flex-col gap-3 min-w-0 shadow-card">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="w-9 h-9 rounded-xl bg-t-bg-surface-raised flex items-center justify-center flex-shrink-0">
            <Icon className={`w-5 h-5 ${ICON_TONE[color] || ICON_TONE.violet}`} />
          </div>
        )}
        <p className="text-xs text-t-text-secondary leading-tight">{titulo}</p>
      </div>
      <div className="text-[24px] md:text-[28px] leading-[1.2] font-semibold tracking-[-0.01em] text-t-text-primary truncate">{valor}</div>
      <div className="flex flex-col items-start gap-1.5 min-w-0">
        {trendLabel && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-xs font-medium max-w-full ${chip}`}>
            {trend > 0 ? <TrendingUp className="w-3.5 h-3.5 flex-shrink-0" /> : trend < 0 ? <TrendingDown className="w-3.5 h-3.5 flex-shrink-0" /> : <Minus className="w-3.5 h-3.5 flex-shrink-0" />}
            <span className="truncate">{trendLabel}</span>
          </span>
        )}
        {subtitulo && <div className="text-xs text-t-text-muted truncate max-w-full">{subtitulo}</div>}
      </div>
    </div>
  );
}
