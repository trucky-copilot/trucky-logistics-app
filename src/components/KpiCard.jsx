import { TrendingUp, TrendingDown } from 'lucide-react';

export default function KpiCard({ titulo, valor, subtitulo, trend, trendLabel, color = 'violet', icon: Icon }) {
  const colorMap = {
    violet: 'text-violet-400 bg-violet-400/10 border-violet-400/20',
    green: 'text-green-400 bg-green-400/10 border-green-400/20',
    red: 'text-red-400 bg-red-400/10 border-red-400/20',
    yellow: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  };
  const iconColor = { violet: 'text-violet-400', green: 'text-green-400', red: 'text-red-400', yellow: 'text-yellow-400' };

  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{titulo}</p>
        {Icon && (
          <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${colorMap[color]}`}>
            <Icon className={`w-4 h-4 ${iconColor[color]}`} />
          </div>
        )}
      </div>
      <div className="space-y-1">
        <div className="text-2xl font-bold text-foreground">{valor}</div>
        {subtitulo && <div className="text-xs text-muted-foreground">{subtitulo}</div>}
        {trendLabel && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trendLabel}
          </div>
        )}
      </div>
    </div>
  );
}