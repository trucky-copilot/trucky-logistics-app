import React from 'react';

// Encabezado común de página: icono, título, subtítulo y acciones opcionales.
export default function PageHeader({ icon: Icon, title, subtitle, children }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="w-11 h-11 rounded-2xl bg-t-action-secondary border border-t-border-default flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5 text-t-text-accent" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="t-h1 truncate">{title}</h1>
          {subtitle && <p className="t-subtitle mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>

      {children && (
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {children}
        </div>
      )}
    </div>
  );
}