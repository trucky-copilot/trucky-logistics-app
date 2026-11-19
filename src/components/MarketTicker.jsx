import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useLanguage } from '@/lib/LanguageContext';

function buildItems(res, isEn) {
  const items = [];
  if (res.diesel) items.push({ label: isEn ? 'DIESEL' : 'DIÉSEL', value: `$${parseFloat(res.diesel).toFixed(2)}/gal` });
  if (res.dry_van) items.push({ label: 'DRY VAN', value: `$${parseFloat(res.dry_van).toFixed(2)}/mi` });
  if (res.reefer) items.push({ label: 'REEFER', value: `$${parseFloat(res.reefer).toFixed(2)}/mi` });
  if (res.flatbed) items.push({ label: 'FLATBED', value: `$${parseFloat(res.flatbed).toFixed(2)}/mi` });
  if (res.step_deck) items.push({ label: 'STEP DECK', value: `$${parseFloat(res.step_deck).toFixed(2)}/mi` });
  if (res.power_only) items.push({ label: 'POWER ONLY', value: `$${parseFloat(res.power_only).toFixed(2)}/mi` });
  if (res.container) items.push({ label: isEn ? 'CONTAINER' : 'CONTENEDOR', value: `$${parseFloat(res.container).toFixed(2)}/mi` });
  return items;
}

function useMarketTickerData() {
  const { locale } = useLanguage();
  const isEn = locale === 'en';
  // Guardamos los datos crudos y armamos las etiquetas al vuelo: así,
  // al cambiar ES/EN, el ticker se traduce sin volver a pedir los datos.
  const [raw, setRaw] = useState(null);

  useEffect(() => {
    base44.entities.GlobalMarketTicker.filter().then(records => {
      const res = records.find(r => r.id === 'global') || records[0];
      if (res) setRaw(res);
    }).catch(err => console.error('[MarketTicker] fetch error:', err));

    const onUpdated = (e) => {
      if (e.detail) setRaw(e.detail);
    };
    window.addEventListener('tickerUpdated', onUpdated);
    return () => window.removeEventListener('tickerUpdated', onUpdated);
  }, []);

  return raw ? buildItems(raw, isEn) : [];
}

function TickerItem({ item }) {
  return (
    <div className="flex items-center gap-2 pr-8 flex-shrink-0 font-mono text-xs font-medium tracking-[0.02em]">
      <span className="uppercase text-t-text-muted">{item.label}</span>
      <span className="text-t-text-primary">{item.value}</span>
    </div>
  );
}

// Figma 8:248 · Market Ticker: franja bg/deep con la etiqueta fija "MERCADO EN VIVO".
export default function MarketTicker() {
  const { locale } = useLanguage();
  const [paused, setPaused] = useState(false);
  const items = useMarketTickerData();

  if (items.length === 0) return null;

  return (
    <div
      className="flex items-center h-12 bg-t-bg-deep flex-shrink-0 min-w-0 overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
      title={paused ? 'Cinta en pausa' : 'Cinta de mercado en vivo'}
    >
      <div className="flex items-center gap-2 pl-4 lg:pl-8 pr-6 flex-shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-t-accent-cyan">
        <span className="trucky-blink w-2 h-2 rounded-full bg-t-accent-cyan inline-block" />
        {locale === 'en' ? 'Live market' : 'Mercado en vivo'}
      </div>
      <div className="relative flex-1 min-w-0 h-full overflow-hidden">
        <div
          className="absolute left-0 top-0 bottom-0 flex items-center flex-shrink-0 animate-trucky-ticker"
          style={{ animationPlayState: paused ? 'paused' : 'running', willChange: 'transform' }}
        >
          {/* Dos copias idénticas para un loop continuo y sin saltos */}
          {[0, 1].map((copy) => (
            <div key={copy} className="flex items-center flex-shrink-0">
              {items.map((item, i) => (
                <TickerItem key={i} item={item} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
