/**
 * OperationalStatusCard
 * ─────────────────────
 * Bloque visual de "Estado operativo" que muestra al usuario
 * qué falta para que Trucky funcione con máxima precisión.
 * No bloquea el uso de la app.
 */

import { CheckCircle2, Circle, AlertCircle, ChevronRight } from 'lucide-react';
import { useAppState } from '@/lib/AppStateContext';
import { useLanguage } from '@/lib/LanguageContext';
import { READINESS_MESSAGES } from '@/lib/goLiveChecklist';
import { useNavigate } from 'react-router-dom';

const LEVEL_META = {
  ready: {
    label_es: 'Listo para operar',
    label_en: 'Ready to operate',
    color:  'text-green-400',
    bg:     'bg-green-400/10',
    border: 'border-green-400/20',
    dot:    'bg-green-400',
  },
  partial: {
    label_es: 'Configuración parcial',
    label_en: 'Partial configuration',
    color:  'text-yellow-400',
    bg:     'bg-yellow-400/10',
    border: 'border-yellow-400/20',
    dot:    'bg-yellow-400',
  },
  basic: {
    label_es: 'Configuración básica',
    label_en: 'Basic configuration',
    color:  'text-red-400',
    bg:     'bg-red-400/10',
    border: 'border-red-400/20',
    dot:    'bg-red-400',
  },
};

const ITEM_ROUTE = {
  carrier_profile:    '/calculadora',
  dispatcher_profile: '/calculadora',
  cost_config:        '/calculadora',
};

function CheckItem({ done, label, route, configureText }) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      {done
        ? <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
        : <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      }
      <span className={`text-xs flex-1 ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
        {label}
      </span>
      {!done && route && (
        <button
          onClick={() => navigate(route)}
          className="flex items-center gap-0.5 text-xs text-primary hover:underline flex-shrink-0"
        >
          {configureText} <ChevronRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export default function OperationalStatusCard() {
  const { operationalReadiness, userProfile, organization } = useAppState();
  const { locale } = useLanguage();

  // No mostrar si ya está todo listo o no hay datos aún
  if (!operationalReadiness) return null;
  if (operationalReadiness.level === 'ready') return null;

  const isEn    = locale === 'en';
  const meta    = LEVEL_META[operationalReadiness.level] || LEVEL_META.partial;
  const missing = operationalReadiness.missing || [];

  // Máximo 4 ítems fijos
  const items = [
    {
      key:   'account',
      label: isEn ? 'Active account' : 'Cuenta activa',
      done:  true,
    },
    {
      key:   'organization',
      label: isEn ? 'Organization created' : 'Organización creada',
      done:  !!(organization?.active),
    },
    {
      key:   'rol',
      label: isEn ? 'Role configured' : 'Rol configurado',
      done:  !!(userProfile?.rol),
    },
    {
      key:   'cost_config',
      label: isEn ? 'Costs configured' : 'Costos configurados',
      done:  !missing.includes('cost_config'),
      route: ITEM_ROUTE.cost_config,
    },
  ];

  const doneCount  = items.filter(i => i.done).length;
  const totalCount = items.length;
  const pct        = Math.round((doneCount / totalCount) * 100);

  return (
    <div className={`glass-panel rounded-2xl border ${meta.border} p-4 md:p-5 space-y-3`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${meta.dot} animate-pulse`} />
          <h3 className="text-sm font-semibold text-foreground">
            {isEn ? 'Operational Status' : 'Estado operativo'}
          </h3>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
          {isEn ? meta.label_en : meta.label_es}
        </span>
      </div>

      {/* Barra de progreso */}
      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>{isEn ? 'Setup progress' : 'Configuración completada'}</span>
          <span className="font-mono">{doneCount}/{totalCount}</span>
        </div>
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              operationalReadiness.level === 'ready'   ? 'bg-green-400' :
              operationalReadiness.level === 'partial' ? 'bg-yellow-400' :
                                                         'bg-red-400'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Lista de ítems */}
      <div className="divide-y divide-border/40">
        {items.map(item => (
          <CheckItem
            key={item.key}
            done={item.done}
            label={item.label}
            route={item.route}
            configureText={isEn ? 'Configure' : 'Configurar'}
          />
        ))}
      </div>

      {/* Mensaje orientativo */}
      {missing.length > 0 && (
        <p className={`text-xs ${meta.color} border-t border-white/5 pt-2 leading-relaxed`}>
          {missing.length === 1
            ? (isEn
                ? (missing[0] === 'cost_config' ? 'Configure your operating costs in the calculator for accurate profitability checks.' : 'Complete the pending setup for maximum accuracy.')
                : (READINESS_MESSAGES[missing[0]] || 'Completa la configuración pendiente para máxima precisión.'))
            : (isEn
                ? 'Your account is active, but not yet fully configured to operate with maximum accuracy.'
                : 'Tu cuenta ya está activa, pero aún no está completamente lista para operar con máxima precisión.')
          }
        </p>
      )}
    </div>
  );
}