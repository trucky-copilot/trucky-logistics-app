import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

function buildItems(res) {
  const items = [];
  if (res.diesel) items.push({ label: 'DIÉSEL', value: `$${parseFloat(res.diesel).toFixed(2)}/gal`, delta: 0 });
  if (res.dry_van) items.push({ label: 'DRY VAN', value: `$${parseFloat(res.dry_van).toFixed(2)}/mi`, delta: 0 });
  if (res.reefer) items.push({ label: 'REEFER', value: `$${parseFloat(res.reefer).toFixed(2)}/mi`, delta: 0 });
  if (res.flatbed) items.push({ label: 'FLATBED', value: `$${parseFloat(res.flatbed).toFixed(2)}/mi`, delta: 0 });
  if (res.step_deck) items.push({ label: 'STEP DECK', value: `$${parseFloat(res.step_deck).toFixed(2)}/mi`, delta: 0 });
  if (res.power_only) items.push({ label: 'POWER ONLY', value: `$${parseFloat(res.power_only).toFixed(2)}/mi`, delta: 0 });
  if (res.container) items.push({ label: 'CONTENEDOR', value: `$${parseFloat(res.container).toFixed(2)}/mi`, delta: 0 });
  return items;
}

function useMarketTickerData() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    // Carga inicial desde BD
    base44.entities.GlobalMarketTicker.filter().then(records => {
      const res = records.find(r => r.id === 'global') || records[0];
      if (res) setItems(buildItems(res));
    }).catch(err => console.error('[MarketTicker] fetch error:', err));

    // Escucha el evento del AdminDashboard para actualizar al instante
    const onUpdated = (e) => {
      if (e.detail) setItems(buildItems(e.detail));
    };
    window.addEventListener('tickerUpdated', onUpdated);
    return () => window.removeEventListener('tickerUpdated', onUpdated);
  }, []);

  return items;
}

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
      <span className="text-[10px] font-mono uppercase tracking-wide text-cyan-400 font-semibold">EN VIVO</span>
      <span className="text-muted-foreground/40 ml-1">·</span>
    </div>
  );
}

export default function MarketTicker() {
  const [paused, setPaused] = useState(false);
  const items = useMarketTickerData();

  if (items.length === 0) return null;

  return (
    <div
      className="hidden lg:flex items-center flex-1 min-w-0 mx-4 h-8 rounded-lg bg-background/40 border border-border/60 overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
      title={paused ? 'Cinta en pausa' : 'Cinta de mercado en vivo'}
    >
      <div
        className="flex items-center flex-shrink-0 animate-trucky-ticker"
        style={{ animationPlayState: paused ? 'paused' : 'running', willChange: 'transform' }}
      >
        {/* Dos copias idénticas para un loop continuo y sin saltos */}
        {[0, 1].map((copy) => (
          <div key={copy} className="flex items-center flex-shrink-0">
            <LiveBadge />
            {items.map((item, i) => (
              <TickerItem key={i} item={item} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}