import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function KpiCard({
  titulo,
  valor,
  subtitulo,
  trend = null,
  trendLabel = null,
  color = 'violet',
  icon: Icon,
}) {
  const colorMap = {
    violet: 'text-white bg-[#5B2BA0]/45 border-white/20 shadow-inner shadow-white/10',
    cyan: 'text-violet-200 bg-[#5B2BA0]/40 border-violet-300/25 shadow-inner shadow-white/10',
    green: 'text-emerald-300 bg-emerald-500/15 border-emerald-400/25 shadow-inner shadow-emerald-400/10',
    red: 'text-red-300 bg-red-500/15 border-red-400/25 shadow-inner shadow-red-400/10',
    yellow: 'text-amber-300 bg-amber-500/15 border-amber-400/25 shadow-inner shadow-amber-400/10',
  };

  const iconColor = {
    violet: 'text-white',
    cyan: 'text-violet-200',
    green: 'text-emerald-300',
    red: 'text-red-300',
    yellow: 'text-amber-300',
  };

  const badgeStyle = colorMap[color] || colorMap.violet;
  const iconStyle = iconColor[color] || iconColor.violet;

  return (
    <motion.div
      whileHover={{ y: -5, scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
      className="glass-card p-5 rounded-2xl relative overflow-hidden group cursor-default"
    >
      {/* Reflejo sutil de cristal en la esquina superior */}
      <div className="pointer-events-none absolute -top-10 -right-10 w-28 h-28 rounded-full bg-[#5B2BA0]/30 blur-2xl group-hover:bg-[#5B2BA0]/50 transition-all duration-300" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

      <div className="relative z-10 flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-white/65 uppercase tracking-wider">{titulo}</p>
        {Icon && (
          <div className={`w-9 h-9 rounded-xl border backdrop-blur-md flex items-center justify-center transition-transform duration-300 group-hover:scale-105 ${badgeStyle}`}>
            <Icon className={`w-4 h-4 ${iconStyle}`} />
          </div>
        )}
      </div>

      <div className="relative z-10 space-y-1">
        <div className="text-2xl font-bold text-white tracking-tight">{valor}</div>
        {subtitulo && <div className="text-xs text-white/60">{subtitulo}</div>}
        {trendLabel && (
          <div className={`flex items-center gap-1 text-xs font-medium pt-0.5 ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {trendLabel}
          </div>
        )}
      </div>
    </motion.div>
  );
}
