// F3-15 · Fase 7 — Accesibilidad: tamaño de texto, reducir movimiento y alto contraste.
import React from 'react';
import { Type, PauseCircle, Contrast } from 'lucide-react';
import { Card, SwitchRow, OptionGroup, usePrefs } from './PreferenceControls';

const tx = (locale, es, en) => (locale === 'en' ? en : es);

export default function AccessibilitySection({ locale }) {
  const [prefs, update] = usePrefs();
  const a = prefs.accesibilidad;
  const set = (cambios) => update('accesibilidad', cambios);

  return (
    <div className="space-y-5">
      <Card
        title={<span className="flex items-center gap-2"><Type className="w-4 h-4 text-t-text-accent" />{tx(locale, 'Tamaño de texto', 'Text size')}</span>}
        desc={tx(locale, 'Agranda los textos de toda la aplicación.', 'Makes the text larger across the whole app.')}
      >
        <OptionGroup
          label={tx(locale, 'Tamaño de texto', 'Text size')}
          value={a.tamano_texto}
          onChange={(v) => set({ tamano_texto: v })}
          options={[
            { id: 'normal', label: tx(locale, 'Normal', 'Normal') },
            { id: 'grande', label: tx(locale, 'Grande', 'Large') },
            { id: 'muy_grande', label: tx(locale, 'Muy grande', 'Extra large') },
          ]}
        />
        <p className="text-sm text-foreground rounded-lg bg-t-bg-input border border-border px-3 py-2">
          {tx(locale, 'Vista previa: Miami, FL → Lakeland, FL · $1,350 · 180 mi', 'Preview: Miami, FL → Lakeland, FL · $1,350 · 180 mi')}
        </p>
      </Card>

      <Card>
        <SwitchRow
          id="pref-motion"
          icon={PauseCircle}
          title={tx(locale, 'Reducir movimiento', 'Reduce motion')}
          desc={tx(locale, 'Detiene el ticker de mercado y las animaciones de la aplicación.', 'Stops the market ticker and the app animations.')}
          checked={a.reducir_movimiento}
          onChange={(v) => set({ reducir_movimiento: v })}
        />
        <div className="border-t border-border" />
        <SwitchRow
          id="pref-contrast"
          icon={Contrast}
          title={tx(locale, 'Alto contraste', 'High contrast')}
          desc={tx(locale, 'Textos secundarios y bordes más marcados, en modo oscuro y claro.', 'Stronger secondary text and borders, in dark and light mode.')}
          checked={a.alto_contraste}
          onChange={(v) => set({ alto_contraste: v })}
        />
      </Card>

      <p className="text-xs text-muted-foreground">{tx(locale, 'Los cambios se aplican al instante y se guardan en este navegador.', 'Changes apply instantly and are saved in this browser.')}</p>
    </div>
  );
}
