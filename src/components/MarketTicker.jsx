import { useState } from 'react';

// Valores estáticos de ejemplo — no conectados a ninguna fuente real.
const TICKER_ITEMS = [
  { label: 'DIÉSEL FL',    value: '$3.89/gal', delta: -0.04 },
  { label: 'DRY VAN',      value: '$2.14/mi',  delta: 0.03 },
  { label: 'REEFER',       value: '$2.51/mi',  delta: 0.05 },
  { label: 'FLATBED',      value: '$2.62/mi',  delta: -0.02 },
  { label: 'DRAYAGE MIA',  value: '$4.10/mi',  delta: 0.08 },
  { label: 'STEP DECK',    value: '$2.78/mi',  delta: 0.01 },
  { label: 'POWER ONLY',   value: '$1.96/mi',  delta: -0.03 },
];

function TickerItem({ item }) {
  const up = item.delta >= 0;
  return (
    <div className="flex items-center gap-1.5 px-3 flex-shrink-0">
      <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">{item.label}</span>
      <span className="text-[11px] font-mono font-bold text-cyan-400">{item.value}</span>
      <span className={`text-[10px] font-mono font-semibold ${up ? 'text-green-400' : 'text-red-400'}`}>
        {up ? '▲' : '▼'} {Math.abs(item.delta).toFixed(2)}
      </span>
      <span className="text-muted-foreground/40 ml-1">·</span>
    </div>
  );
}

function LiveBadge() {
  return (
    <div className="flex items-center gap-1.5 px-3 flex-shrink-0">
      <span className="trucky-blink w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block" />
      <span className="text-[10px] font-mono uppercase tracking-wide text-cyan-400 font-semibold">Referencia — datos de ejemplo</span>
      <span className="text-muted-foreground/40 ml-1">·</span>
    </div>
  );
}

export default function MarketTicker() {
  const [paused, setPaused] = useState(false);

  return (
    <div
      className="hidden lg:flex items-center flex-1 min-w-0 mx-4 h-8 rounded-lg bg-background/40 border border-border/60 overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
      title={paused ? 'Cinta en pausa' : 'Cinta de mercado en vivo (ejemplo)'}
    >
      <div
        className="flex items-center flex-shrink-0 animate-trucky-ticker"
        style={{ animationPlayState: paused ? 'paused' : 'running', willChange: 'transform' }}
      >
        {/* Dos copias idénticas para un loop continuo y sin saltos */}
        {[0, 1].map((copy) => (
          <div key={copy} className="flex items-center flex-shrink-0">
            <LiveBadge />
            {TICKER_ITEMS.map((item, i) => (
              <TickerItem key={i} item={item} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}