/**
 * FreightReferencePanel
 * Panel de referencia rápida para freight dispatching.
 * Consume la KB a través del freightAdapter — nunca hardcoded aquí.
 */
import { useState } from 'react';
import {
  getRpmBenchmarks,
  getFlatRateMinimums,
  getLoadTypes,
  getAccessorials,
  getHosRules,
  getRedFlags,
  getScenarios,
} from '@/lib/freight';

const TABS = [
  { id: 'rpm',          label: 'RPM'          },
  { id: 'flat',         label: 'Flat Mín.'    },
  { id: 'loads',        label: 'Tipos de Carga'},
  { id: 'accessorials', label: 'Accessorials' },
  { id: 'hos',          label: 'HOS'          },
  { id: 'red_flags',    label: 'Red Flags'    },
  { id: 'scenarios',    label: 'Escenarios'   },
];

function RpmTable() {
  const benchmarks = getRpmBenchmarks();
  if (!benchmarks.length) return <p className="text-muted-foreground text-xs">Sin datos.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground border-b border-border">
            <th className="text-left py-1.5 font-medium">Equipo</th>
            <th className="text-right py-1.5 font-medium text-yellow-400">Mínimo</th>
            <th className="text-right py-1.5 font-medium text-green-400">Bueno</th>
            <th className="text-right py-1.5 font-medium text-primary">Excelente</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {benchmarks.map((b, i) => (
            <tr key={i} className="hover:bg-muted/30 transition-colors">
              <td className="py-1.5 text-foreground font-medium">{b.equipment}</td>
              <td className="py-1.5 text-right font-mono text-yellow-400">${b.min.toFixed(2)}</td>
              <td className="py-1.5 text-right font-mono text-green-400">${b.good.toFixed(2)}</td>
              <td className="py-1.5 text-right font-mono text-primary">${b.excellent.toFixed(2)}+</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FlatRateTable() {
  const ranges = getFlatRateMinimums();
  if (!ranges.length) return <p className="text-muted-foreground text-xs">Sin datos.</p>;
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground mb-2">Usar el MAYOR entre fórmula RPM y este mínimo.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="text-left py-1.5 font-medium">Distancia</th>
              <th className="text-right py-1.5 font-medium">Mínimo</th>
              <th className="text-right py-1.5 font-medium">Máximo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {ranges.map((r, i) => (
              <tr key={i} className="hover:bg-muted/30 transition-colors">
                <td className="py-1.5 text-foreground">{r.range}</td>
                <td className="py-1.5 text-right font-mono text-green-400">${r.min.toLocaleString()}</td>
                <td className="py-1.5 text-right font-mono text-muted-foreground">
                  {r.max ? `$${r.max.toLocaleString()}` : r.min > 0 ? '$'+r.min.toLocaleString()+'+' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LoadTypesPanel() {
  const types = getLoadTypes();
  const [selected, setSelected] = useState(types[0]?.id || null);
  const current = types.find(t => t.id === selected);

  if (!types.length) return <p className="text-muted-foreground text-xs">Sin datos.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {types.map(t => (
          <button
            key={t.id}
            onClick={() => setSelected(t.id)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
              selected === t.id
                ? 'bg-primary/20 border-primary text-primary'
                : 'border-border text-muted-foreground hover:border-primary/50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {current && (
        <div className="bg-muted/30 rounded-lg p-3 space-y-2">
          <p className="text-xs text-foreground">{current.description}</p>

          {current.rpm_min && (
            <div className="flex gap-2 text-xs">
              <span className="text-muted-foreground">RPM:</span>
              <span className="text-yellow-400 font-mono">${current.rpm_min.toFixed(2)}</span>
              {current.rpm_max && <><span className="text-muted-foreground">→</span><span className="text-green-400 font-mono">${current.rpm_max.toFixed(2)}/mi</span></>}
            </div>
          )}

          {current.watch_for?.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-1">⚠️ Atención:</p>
              <ul className="space-y-0.5">
                {current.watch_for.map((w, i) => <li key={i} className="text-xs text-foreground">• {w}</li>)}
              </ul>
            </div>
          )}

          {current.always_ask?.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-1">❓ Siempre preguntar:</p>
              <ul className="space-y-0.5">
                {current.always_ask.map((a, i) => <li key={i} className="text-xs text-foreground">• {a}</li>)}
              </ul>
            </div>
          )}

          {current.extra_costs?.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-1">💸 Costos extra:</p>
              <ul className="space-y-0.5">
                {current.extra_costs.map((c, i) => <li key={i} className="text-xs text-foreground">• {c}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AccessorialsPanel() {
  const items = getAccessorials();
  if (!items.length) return <p className="text-muted-foreground text-xs">Sin datos.</p>;
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground mb-2">Nunca incluir en tarifa all-in sin negociar explícitamente.</p>
      {items.map((a, i) => (
        <div key={i} className="flex items-start justify-between gap-2 py-1.5 border-b border-border/40 last:border-0">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-foreground font-medium">{a.service}</p>
            {a.note && <p className="text-xs text-muted-foreground">{a.note}</p>}
          </div>
          <div className="text-right flex-shrink-0">
            {a.min !== null && (
              <span className="text-xs font-mono text-green-400">
                {typeof a.min === 'number' && a.min < 10
                  ? `$${a.min.toFixed(2)}${a.max && a.max !== a.min ? `–$${a.max.toFixed(2)}` : ''}`
                  : `$${a.min}${a.max && a.max !== a.min ? `–$${a.max}` : ''}`
                }{a.unit}
              </span>
            )}
            {a.min === null && <span className="text-xs text-muted-foreground">Pass-through</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function HosPanel() {
  const hos = getHosRules();
  if (!hos?.rules?.length) return <p className="text-muted-foreground text-xs">Sin datos.</p>;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="text-left py-1.5 font-medium">Regla</th>
              <th className="text-right py-1.5 font-medium">Límite</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {hos.rules.map((r, i) => (
              <tr key={i} className="hover:bg-muted/30 transition-colors">
                <td className="py-1.5 text-foreground">{r.rule}</td>
                <td className="py-1.5 text-right text-primary font-medium">{r.limit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hos.short_haul_exemption && (
        <div className="bg-muted/30 rounded-lg p-2.5">
          <p className="text-xs text-muted-foreground font-medium mb-1">Exención Short-Haul:</p>
          <p className="text-xs text-foreground">{hos.short_haul_exemption}</p>
        </div>
      )}
    </div>
  );
}

function RedFlagsPanel() {
  const flags = getRedFlags();
  return (
    <div className="space-y-4">
      {flags.auto_decline?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-red-400 mb-2">🚫 Rechazo Automático</p>
          <ul className="space-y-1">
            {flags.auto_decline.map((f, i) => (
              <li key={i} className="text-xs text-foreground flex gap-1.5">
                <span className="text-red-400 flex-shrink-0">•</span>{f}
              </li>
            ))}
          </ul>
        </div>
      )}
      {flags.proceed_with_caution?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-yellow-400 mb-2">⚠️ Proceder con Cautela</p>
          <ul className="space-y-1">
            {flags.proceed_with_caution.map((f, i) => (
              <li key={i} className="text-xs text-foreground flex gap-1.5">
                <span className="text-yellow-400 flex-shrink-0">•</span>{f}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ScenariosPanel() {
  const scenarios = getScenarios();
  const [selected, setSelected] = useState(scenarios[0]?.id || null);
  const current = scenarios.find(s => s.id === selected);

  if (!scenarios.length) return <p className="text-muted-foreground text-xs">Sin datos.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {scenarios.map(s => (
          <button
            key={s.id}
            onClick={() => setSelected(s.id)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
              selected === s.id
                ? 'bg-primary/20 border-primary text-primary'
                : 'border-border text-muted-foreground hover:border-primary/50'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {current && (
        <div className="bg-muted/30 rounded-lg p-3 space-y-3">
          <p className="text-xs text-muted-foreground italic">{current.situation}</p>

          {current.steps?.length > 0 && (
            <div>
              <p className="text-xs text-foreground font-medium mb-1.5">Pasos:</p>
              <ol className="space-y-1">
                {current.steps.map((step, i) => (
                  <li key={i} className="text-xs text-foreground flex gap-2">
                    <span className="text-primary font-mono flex-shrink-0">{i + 1}.</span>{step}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {current.template && (
            <div>
              <p className="text-xs text-foreground font-medium mb-1.5">Template:</p>
              <pre className="text-xs text-muted-foreground bg-background/60 rounded-lg p-2.5 whitespace-pre-wrap font-mono overflow-x-auto">
                {current.template}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FreightReferencePanel({ className = '' }) {
  const [activeTab, setActiveTab] = useState('rpm');

  const renderContent = () => {
    switch (activeTab) {
      case 'rpm':          return <RpmTable />;
      case 'flat':         return <FlatRateTable />;
      case 'loads':        return <LoadTypesPanel />;
      case 'accessorials': return <AccessorialsPanel />;
      case 'hos':          return <HosPanel />;
      case 'red_flags':    return <RedFlagsPanel />;
      case 'scenarios':    return <ScenariosPanel />;
      default:             return null;
    }
  };

  return (
    <div className={`bg-card border border-border rounded-xl ${className}`}>
      <div className="p-4 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Referencia de Dispatching</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Guía operativa consolidada</p>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto border-b border-border px-4 gap-0.5 pt-2 scrollbar-hide">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`text-xs whitespace-nowrap px-3 py-2 border-b-2 transition-all ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {renderContent()}
      </div>
    </div>
  );
}