// Piezas visuales comunes de la pantalla Tarifas (mismo estilo oscuro del panel admin).
import React from 'react';
import { X, Loader2 } from 'lucide-react';

export const Card = ({ children, className = '' }) => (
  <div className={`bg-[#1C1C1E] border border-white/5 p-4 md:p-6 rounded-2xl ${className}`}>{children}</div>
);

export function Btn({ children, variant = 'primary', busy = false, className = '', ...props }) {
  const styles = {
    primary: 'bg-amber-500 hover:bg-amber-600 text-black',
    ghost: 'bg-white/5 hover:bg-white/10 text-white border border-white/10',
    danger: 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30',
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
    <span className="block text-xs font-medium text-white/60 mb-1">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-white/40 mt-1">{hint}</span>}
  </label>
);

const inputCls = 'w-full bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-sm text-white focus:outline-none focus:border-amber-500/50';
export const Input = (props) => <input {...props} className={`${inputCls} ${props.className || ''}`} />;
export const Select = ({ children, ...props }) => (
  <select {...props} className={`${inputCls} ${props.className || ''}`}>{children}</select>
);
export const TextArea = (props) => <textarea rows={3} {...props} className={`${inputCls} ${props.className || ''}`} />;

export const Badge = ({ children, tone = 'gray' }) => {
  const tones = {
    gray: 'bg-white/10 text-white/70', green: 'bg-emerald-500/15 text-emerald-300',
    red: 'bg-red-500/15 text-red-300', amber: 'bg-amber-500/15 text-amber-300', blue: 'bg-sky-500/15 text-sky-300',
  };
  return <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
};

export function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start md:items-center justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div
        className={`bg-[#1C1C1E] border border-white/10 rounded-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-xl'} p-5 space-y-4 my-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-white/50 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const ErrorBox = ({ error }) => error ? (
  <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl p-3">{error}</div>
) : null;

export const Empty = ({ children }) => <p className="text-sm text-white/40 py-6 text-center">{children}</p>;

// Tabla simple con scroll horizontal en celular.
export const Table = ({ head, children }) => (
  <div className="overflow-x-auto -mx-4 md:mx-0">
    <table className="w-full text-sm text-white/80 min-w-[640px]">
      <thead>
        <tr className="text-left text-xs text-white/50 border-b border-white/10">
          {head.map((h) => <th key={h} className="py-2 px-2 font-medium whitespace-nowrap">{h}</th>)}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);
export const Td = ({ children, className = '' }) => <td className={`py-2 px-2 border-b border-white/5 align-top ${className}`}>{children}</td>;
