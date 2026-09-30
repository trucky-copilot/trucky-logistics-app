import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

function useMarketTickerData() {

  const [items, setItems] = useState([]);

  useEffect(() => {
    try {
      base44.entities.GlobalMarketTicker.filter({ id: 'global' }).then(records => {
        if (records && records.length > 0) {
          const res = records[0];
          const newItems = [];
          if (res.diesel) newItems.push({ label: 'DIÉSEL', value: `$${res.diesel.toFixed(2)}/gal`, delta: 0 });
          if (res.dry_van) newItems.push({ label: 'DRY VAN', value: `$${res.dry_van.toFixed(2)}/mi`, delta: 0 });
          if (res.reefer) newItems.push({ label: 'REEFER', value: `$${res.reefer.toFixed(2)}/mi`, delta: 0 });
          if (res.flatbed) newItems.push({ label: 'FLATBED', value: `$${res.flatbed.toFixed(2)}/mi`, delta: 0 });
          if (res.step_deck) newItems.push({ label: 'STEP DECK', value: `$${res.step_deck.toFixed(2)}/mi`, delta: 0 });
          if (res.power_only) newItems.push({ label: 'POWER ONLY', value: `$${res.power_only.toFixed(2)}/mi`, delta: 0 });
          if (res.container) newItems.push({ label: 'CONTENEDOR', value: `$${res.container.toFixed(2)}/mi`, delta: 0 });
          setItems(newItems);
        }
      }).catch(err => {
        console.error('Error fetching ticker:', err);
      });
    } catch (e) {
      console.error('Error in useMarketTickerData:', e);
    }
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
      <span className="text-[10px] font-mono uppercase tracking-wide text-cyan-400 font-semibold">Referencia — datos de ejemplo</span>
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