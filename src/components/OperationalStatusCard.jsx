/**
 * OperationalStatusCard
 * ─────────────────────
 * Bloque visual de "Estado operativo" que muestra al usuario
 * qué falta para que Trucky funcione con máxima precisión.
 * No bloquea el uso de la app.
 */

import { CheckCircle2, Circle, AlertCircle, ChevronRight } from 'lucide-react';
import { useAppState } from '@/lib/AppStateContext';
import { READINESS_MESSAGES } from '@/lib/goLiveChecklist';
import { useNavigate } from 'react-router-dom';

const LEVEL_META = {
  ready: {
    label:  'Listo para operar',
    color:  'text-green-400',
    bg:     'bg-green-400/10',
    border: 'border-green-400/20',
    dot:    'bg-green-400',
  },
  partial: {
    label:  'Configuración parcial',
    color:  'text-yellow-400',
    bg:     'bg-yellow-400/10',
    border: 'border-yellow-400/20',
    dot:    'bg-yellow-400',
  },
  basic: {
    label:  'Configuración básica',
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

function CheckItem({ done, label, route }) {
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
          Configurar <ChevronRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export default function OperationalStatusCard() {
  const { operationalReadiness, userProfile, organization } = useAppState();

  // No mostrar si ya está todo listo o no hay datos aún
  if (!operationalReadiness) return null;
  if (operationalReadiness.level === 'ready') return null;

  const meta    = LEVEL_META[operationalReadiness.level] || LEVEL_META.partial;
  const missing = operationalReadiness.missing || [];

  // Construir lista de ítems para mostrar
  const items = [
    {
      key:   'account',
      label: 'Cuenta activa',
      done:  true,
    },
    {
      key:   'organization',
      label: 'Organización creada',
      done:  !!(organization?.active),
    },
    {
      key:   'rol',
      label: 'Rol configurado',
      done:  !!(userProfile?.rol),
    },
    {
      key:   'carrier_profile',
      label: 'Perfil operativo del carrier completo',
      done:  !missing.includes('carrier_profile'),
      route: ITEM_ROUTE.carrier_profile,
    },
    {
      key:   'dispatcher_profile',
      label: 'Perfil de dispatcher creado',
      done:  !missing.includes('dispatcher_profile'),
      route: ITEM_ROUTE.dispatcher_profile,
    },
    {
      key:   'cost_config',
      label: 'Costos operativos configurados',
      done:  !missing.includes('cost_config'),
      route: ITEM_ROUTE.cost_config,
    },
  ].filter(item => {
    // Ocultar ítems que no aplican al rol
    if (item.key === 'carrier_profile' && userProfile?.rol === 'dispatcher') return false;
    if (item.key === 'dispatcher_profile' && userProfile?.rol === 'carrier') return false;
    if (item.key === 'cost_config' && userProfile?.rol === 'dispatcher') return false;
    return true;
  });

  const doneCount  = items.filter(i => i.done).length;
  const totalCount = items.length;
  const pct        = Math.round((doneCount / totalCount) * 100);

  return (
    <div className={`rounded-xl border ${meta.border} p-4 space-y-3`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${meta.dot} animate-pulse`} />
          <h3 className="text-sm font-semibold text-foreground">Estado operativo</h3>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
          {meta.label}
        </span>
      </div>

      {/* Barra de progreso */}
      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Configuración completada</span>
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
          />
        ))}
      </div>

      {/* Mensaje orientativo */}
      {missing.length > 0 && (
        <p className={`text-xs ${meta.color} border-t border-white/5 pt-2 leading-relaxed`}>
          {missing.length === 1
            ? READINESS_MESSAGES[missing[0]] || 'Completa la configuración pendiente para máxima precisión.'
            : 'Tu cuenta ya está activa, pero aún no está completamente lista para operar con máxima precisión.'
          }
        </p>
      )}
    </div>
  );
}