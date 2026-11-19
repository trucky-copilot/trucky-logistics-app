// Piezas visuales comunes de la pantalla Tarifas (mismo estilo oscuro del panel admin).
import React from 'react';
import { X, Loader2 } from 'lucide-react';

export const Card = ({ children, className = '' }) => (
  <div className={`bg-card border border-t-border-subtle p-4 md:p-6 rounded-2xl ${className}`}>{children}</div>
);

export function Btn({ children, variant = 'primary', busy = false, className = '', ...props }) {
  const styles = {
    primary: 'bg-amber-500 hover:bg-amber-600 text-black',
    ghost: 'bg-foreground/5 hover:bg-foreground/10 text-foreground border border-border',
    danger: 'bg-red-500/15 hover:bg-red-500/25 text-t-danger border border-red-500/30',
  };
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

export const Field = ({ label, children, hint }) => (
  <label className="block">
    <span className="block text-xs font-medium text-foreground/60 mb-1">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-foreground/40 mt-1">{hint}</span>}
  </label>
);

const inputCls = 'w-full bg-t-bg-input border border-border rounded-xl py-2 px-3 text-sm text-foreground focus:outline-none focus:border-amber-500/50';
export const Input = (props) => <input {...props} className={`${inputCls} ${props.className || ''}`} />;
// La lista desplegable nativa sigue el tema (color-scheme en <html>)
// (antes salía blanca con texto blanco); las opciones usan el mismo fondo del panel.
export const Select = ({ children, ...props }) => (
  <select {...props} style={props.style}
    className={`${inputCls} [&>option]:bg-t-bg-surface [&>option]:text-t-text-primary ${props.className || ''}`}>{children}</select>
);
export const TextArea = (props) => <textarea rows={3} {...props} className={`${inputCls} ${props.className || ''}`} />;

export const Badge = ({ children, tone = 'gray' }) => {
  const tones = {
    gray: 'bg-foreground/10 text-foreground/70', green: 'bg-emerald-500/15 text-t-success',
    red: 'bg-red-500/15 text-t-danger', amber: 'bg-amber-500/15 text-t-warning', blue: 'bg-sky-500/15 text-t-accent-cyan',
  };
  return <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
};

// Ventana con alto máximo de la pantalla: el título y los botones (footer) quedan
// siempre visibles y solo el contenido hace scroll. Antes, con contenido largo, se
// centraba y se cortaba arriba y abajo.
export function Modal({ title, onClose, children, footer = null, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 bg-[var(--t-overlay)] flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div
        className={`bg-card border border-border rounded-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-xl'} max-h-full flex flex-col overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border flex-shrink-0">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="text-foreground/50 hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
        {footer && <div className="flex-shrink-0 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export const ErrorBox = ({ error }) => error ? (
  <div className="text-sm text-t-danger bg-red-500/10 border border-red-500/20 rounded-xl p-3">{error}</div>
) : null;

export const Empty = ({ children }) => <p className="text-sm text-foreground/40 py-6 text-center">{children}</p>;

// Tabla simple con scroll horizontal en celular.
export const Table = ({ head, children }) => (
  <div className="overflow-x-auto -mx-4 md:mx-0">
    <table className="w-full text-sm text-foreground/80 min-w-[640px]">
      <thead>
        <tr className="text-left text-xs text-foreground/50 border-b border-border">
          {head.map((h) => <th key={h} className="py-2 px-2 font-medium whitespace-nowrap">{h}</th>)}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);
export const Td = ({ children, className = '' }) => <td className={`py-2 px-2 border-b border-t-border-subtle align-top ${className}`}>{children}</td>;
