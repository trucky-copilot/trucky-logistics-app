import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Calculator, Save, TrendingUp, TrendingDown, DollarSign, Fuel, Loader2 } from 'lucide-react';

const QUICKLOAD_RATE = 2.20;
const TARGET_RATE = 3.00;

export default function CostCalculator() {
  const [config, setConfig] = useState({
    diesel_precio: 5.40, mpg: 6.5, seguro_semanal: 800,
    lease_semanal: 1200, pago_conductor_porcentaje: 25,
    otros_gastos_semanales: 300, millas_semana_promedio: 2500, tarifa_objetivo: 3.0,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [configId, setConfigId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const user = await base44.auth.me();
        const configs = await base44.entities.CostConfig.filter({ usuario: user.email });
        if (configs.length > 0) {
          setConfig(configs[0]);
          setConfigId(configs[0].id);
        }
      } catch (e) {
        // mantener valores por defecto si falla la carga
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const set = (key, val) => setConfig(prev => ({ ...prev, [key]: val }));

  // Calculations
  const dieselPerMile = config.diesel_precio / config.mpg;
  const totalFixedWeekly = (Number(config.seguro_semanal) || 0) + (Number(config.lease_semanal) || 0) + (Number(config.otros_gastos_semanales) || 0);
  const fixedPerMile = config.millas_semana_promedio > 0 ? totalFixedWeekly / config.millas_semana_promedio : 0;
  const variablePerMile = dieselPerMile;
  const driverFraction = (Number(config.pago_conductor_porcentaje) || 0) / 100;
  // costo_por_milla without driver (driver is % of revenue, not cost)
  const costPerMile = variablePerMile + fixedPerMile;
  // break-even: revenue × (1 - driver%) = costPerMile → revenue = costPerMile / (1 - driver%)
  const breakEvenRate = driverFraction < 1 ? costPerMile / (1 - driverFraction) : 0;
  const targetProfit = config.tarifa_objetivo - breakEvenRate;

  const quickloadProfit = QUICKLOAD_RATE - breakEvenRate;
  const quickloadStatus = quickloadProfit > 0.1 ? 'ganancia' : quickloadProfit > -0.1 ? 'break_even' : 'perdida';

  const saveConfig = async () => {
    setSaving(true);
    const user = await base44.auth.me();
    const data = {
      ...config,
      usuario: user.email,
      costo_por_milla: costPerMile,
      tarifa_break_even: breakEvenRate,
    };
    if (configId) {
      await base44.entities.CostConfig.update(configId, data);
    } else {
      const created = await base44.entities.CostConfig.create(data);
      setConfigId(created.id);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const barSegments = [
    { label: 'Q-Load\n$2.20', rate: QUICKLOAD_RATE, color: quickloadStatus === 'ganancia' ? '#4ade80' : '#f87171' },
    { label: 'Break-Even', rate: breakEvenRate, color: '#facc15' },
    { label: 'Objetivo', rate: Number(config.tarifa_objetivo), color: '#22d3ee' },
    { label: 'Mercado\nFlorida', rate: 3.10, color: '#a78bfa' },
  ];
  const maxRate = Math.max(...barSegments.map(s => s.rate), 4);

  if (loading) return <div className="flex justify-center items-center h-full"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Calculator className="w-5 h-5 text-primary" />
          Calculadora de Costo/Milla
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Calcula tu break-even y tarifa mínima rentable</p>
      </div>

      {/* Inputs */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Variables del negocio</h2>
        
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1 block"><Fuel className="w-3 h-3" />Precio diésel ($/gal)</label>
            <input type="number" step="0.01" value={config.diesel_precio}
              onChange={e => set('diesel_precio', Number(e.target.value))}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">MPG del camión</label>
            <input type="number" step="0.1" value={config.mpg}
              onChange={e => set('mpg', Number(e.target.value))}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Seguro ($/semana)</label>
            <input type="number" value={config.seguro_semanal}
              onChange={e => set('seguro_semanal', Number(e.target.value))}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Lease/renta ($/semana)</label>
            <input type="number" value={config.lease_semanal}
              onChange={e => set('lease_semanal', Number(e.target.value))}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">% pago conductor</label>
            <input type="number" value={config.pago_conductor_porcentaje}
              onChange={e => set('pago_conductor_porcentaje', Number(e.target.value))}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Otros gastos ($/semana)</label>
            <input type="number" value={config.otros_gastos_semanales}
              onChange={e => set('otros_gastos_semanales', Number(e.target.value))}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Millas/semana promedio</label>
            <input type="number" value={config.millas_semana_promedio}
              onChange={e => set('millas_semana_promedio', Number(e.target.value))}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Tarifa objetivo ($/mi)</label>
            <input type="number" step="0.01" value={config.tarifa_objetivo}
              onChange={e => set('tarifa_objetivo', Number(e.target.value))}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Resultados</h2>
        
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-xs text-muted-foreground">Costo por milla</p>
            <p className="text-xl font-bold font-mono text-foreground mt-1">${costPerMile.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">diesel + fijos</p>
          </div>
          <div className="bg-yellow-400/10 border border-yellow-400/20 rounded-xl p-3 text-center">
            <p className="text-xs text-yellow-400">Break-even</p>
            <p className="text-xl font-bold font-mono text-yellow-400 mt-1">${breakEvenRate.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">tarifa mínima</p>
          </div>
          <div className="bg-cyan-400/10 border border-cyan-400/20 rounded-xl p-3 text-center col-span-2 sm:col-span-1">
            <p className="text-xs text-cyan-400">Tarifa objetivo</p>
            <p className="text-xl font-bold font-mono text-cyan-400 mt-1">${Number(config.tarifa_objetivo).toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">+${targetProfit.toFixed(2)}/mi ganancia</p>
          </div>
        </div>

        {/* Rate comparison bars */}
        <div className="space-y-2.5">
          {barSegments.map((seg, i) => (
            <div key={i} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{seg.label.replace('\n', ' ')}</span>
                <span className="font-mono font-medium text-foreground">${seg.rate.toFixed(2)}/mi</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${(seg.rate / maxRate) * 100}%`, backgroundColor: seg.color }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Quickload verdict */}
        <div className={`rounded-xl border p-3 ${quickloadStatus === 'ganancia' ? 'bg-green-400/10 border-green-400/20' : 'bg-red-400/10 border-red-400/20'}`}>
          <div className="flex items-center gap-2">
            {quickloadStatus === 'ganancia' 
              ? <TrendingUp className="w-4 h-4 text-green-400" />
              : <TrendingDown className="w-4 h-4 text-red-400" />
            }
            <span className={`text-sm font-semibold ${quickloadStatus === 'ganancia' ? 'text-green-400' : 'text-red-400'}`}>
              Quickload ($2.20/mi): {quickloadStatus === 'ganancia' ? '✓ Rentable' : '✕ Pérdida'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {quickloadProfit > 0 
              ? `Ganas $${quickloadProfit.toFixed(2)}/milla sobre tu break-even`
              : `Pierdes $${Math.abs(quickloadProfit).toFixed(2)}/milla — rechaza o negocia`
            }
          </p>
        </div>
      </div>

      <button onClick={saveConfig} disabled={saving}
        className="w-full py-3 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-60 text-sm font-semibold text-primary-foreground flex items-center justify-center gap-2 transition-all">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saved ? '✓ Guardado' : 'Guardar configuración'}
      </button>
    </div>
  );
}