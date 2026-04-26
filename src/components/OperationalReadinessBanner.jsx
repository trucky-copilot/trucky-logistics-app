/**
 * OperationalReadinessBanner
 * ──────────────────────────
 * Muestra avisos no bloqueantes cuando el workspace aún no está
 * completamente listo para operar con máxima precisión.
 *
 * Solo aparece si operational_readiness !== 'ready'.
 * El usuario puede cerrar el banner; se oculta hasta la próxima recarga.
 */

import { useState } from 'react';
import { AlertTriangle, Info, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useAppState } from '@/lib/AppStateContext';
import { READINESS_MESSAGES } from '@/lib/goLiveChecklist';
import { useNavigate } from 'react-router-dom';

const LEVEL_CONFIG = {
  basic: {
    icon:    AlertTriangle,
    color:   'text-yellow-400',
    bg:      'bg-yellow-400/8',
    border:  'border-yellow-400/25',
    headline: 'Tu cuenta ya está activa, pero aún no está completamente lista para operar con máxima precisión.',
  },
  partial: {
    icon:    Info,
    color:   'text-cyan-400',
    bg:      'bg-cyan-400/8',
    border:  'border-cyan-400/25',
    headline: 'Casi listo — completa la configuración pendiente para resultados más confiables.',
  },
};

// A qué página lleva cada ítem faltante
const ITEM_ROUTE = {
  carrier_profile:    '/calculadora',
  dispatcher_profile: '/calculadora',
  cost_config:        '/calculadora',
};

export default function OperationalReadinessBanner() {
  const { operationalReadiness } = useAppState();
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded]   = useState(false);
  const navigate = useNavigate();

  if (!operationalReadiness) return null;
  if (operationalReadiness.level === 'ready') return null;
  if (dismissed) return null;

  const cfg     = LEVEL_CONFIG[operationalReadiness.level] || LEVEL_CONFIG.partial;
  const Icon    = cfg.icon;
  const missing = operationalReadiness.missing || [];

  return (
    <div className={`border-b ${cfg.border} ${cfg.bg}`}>
      <div className="max-w-5xl mx-auto px-4 py-2.5">
        {/* Row principal */}
        <div className="flex items-start gap-2.5">
          <Icon className={`w-4 h-4 ${cfg.color} flex-shrink-0 mt-0.5`} />

          <div className="flex-1 min-w-0">
            <p className={`text-xs font-medium ${cfg.color}`}>{cfg.headline}</p>

            {/* Detalle expandible */}
            {missing.length > 0 && (
              <>
                {expanded && (
                  <ul className="mt-2 space-y-1">
                    {missing.map(key => (
                      <li key={key} className="flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-muted-foreground flex-shrink-0" />
                        <span className="text-xs text-muted-foreground flex-1">
                          {READINESS_MESSAGES[key] || key}
                        </span>
                        {ITEM_ROUTE[key] && (
                          <button
                            onClick={() => navigate(ITEM_ROUTE[key])}
                            className={`text-xs font-medium ${cfg.color} hover:underline flex-shrink-0`}
                          >
                            Configurar →
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  onClick={() => setExpanded(v => !v)}
                  className={`flex items-center gap-1 mt-1 text-xs ${cfg.color} hover:underline`}
                >
                  {expanded ? 'Ocultar detalles' : `Ver ${missing.length} ítem${missing.length > 1 ? 's' : ''} pendiente${missing.length > 1 ? 's' : ''}`}
                  {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </>
            )}
          </div>

          {/* Cerrar */}
          <button
            onClick={() => setDismissed(true)}
            className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
            aria-label="Cerrar aviso"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}