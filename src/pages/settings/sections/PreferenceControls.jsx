// Controles compartidos de las secciones de preferencias (F3-15 fase 7).
import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { readPrefs, savePrefs, PREFS_EVENT } from '@/lib/userPreferences';

/** Preferencias guardadas + función para cambiar una parte ('accesibilidad' | 'notificaciones'). */
export function usePrefs() {
  const [prefs, setPrefs] = useState(readPrefs);
  useEffect(() => {
    const on = (e) => e.detail && setPrefs(e.detail);
    window.addEventListener(PREFS_EVENT, on);
    return () => window.removeEventListener(PREFS_EVENT, on);
  }, []);
  const update = (grupo, cambios) => {
    const next = { ...prefs, [grupo]: { ...prefs[grupo], ...cambios } };
    setPrefs(savePrefs(next));
  };
  return [prefs, update];
}

export function Card({ title, desc, children }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      {(title || desc) && (
        <div>
          {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
          {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

export function SwitchRow({ id, icon: Icon, title, desc, checked, onChange }) {
  return (
    <div className="flex items-start gap-3">
      {Icon && <Icon className="w-5 h-5 text-t-text-accent mt-0.5 flex-shrink-0" />}
      <label htmlFor={id} className="flex-1 min-w-0 cursor-pointer">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {desc && <div className="text-xs text-muted-foreground">{desc}</div>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  );
}

export function OptionGroup({ label, value, options, onChange }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
          className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors ${value === o.id ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card hover:bg-muted text-muted-foreground'}`}>
          <span className="truncate">{o.label}</span>
          {value === o.id && <Check className="w-4 h-4 text-t-text-accent flex-shrink-0" />}
        </button>
      ))}
    </div>
  );
}
