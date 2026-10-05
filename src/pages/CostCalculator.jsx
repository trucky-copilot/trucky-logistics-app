import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { deriveCosts, CAMPO_LABEL } from '@/lib/freight/costMath';
import { Calculator, Save, TrendingUp, TrendingDown, Fuel, Loader2 } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useProfile } from '@/lib/ProfileContext';

const QUICKLOAD_RATE = 2.20;
const TARGET_RATE = 3.00;

export default function CostCalculator() {
  const { t } = useLanguage();
  const { activeProfileId, setUnsavedChanges } = useProfile();
  const [config, setConfig] = useState({
    diesel_precio: 5.40, mpg: 6.5, seguro_semanal: 800,
    lease_semanal: 1200, pago_conductor_porcentaje: 25,
    otros_gastos_semanales: 300, millas_semana_promedio: 2500, tarifa_objetivo: 3.0,
    custom_accessorials_active: false, custom_accessorials_text: ''
  });
  const [originalConfig, setOriginalConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [configId, setConfigId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const user = await base44.auth.me();
        
        const configs = await base44.entities.CostConfig.filter({ usuario: user.email });
        
        // Fase 2 de Aislamiento: Buscar estrictamente por profile_id en la nube (ignorar localStorage)
        let targetConfig = configs.find(c => (c.profile_id || '1') === activeProfileId);

        if (targetConfig) {
          setConfig(prev => ({ ...prev, ...targetConfig }));
          setOriginalConfig({ ...targetConfig });
          setConfigId(targetConfig.id);
        } else {
          // Reset to default if new profile has no data
          const def = {
            diesel_precio: 5.40, mpg: 6.5, seguro_semanal: 800,
            lease_semanal: 1200, pago_conductor_porcentaje: 25,
            otros_gastos_semanales: 300, millas_semana_promedio: 2500, tarifa_objetivo: 3.0,
            custom_accessorials_active: false, custom_accessorials_text: ''
          };
          setConfig(def);
          setOriginalConfig(def);
          setConfigId(null);
        }
      } catch (e) {
        console.error("Error cargando CostConfig:", e);
      } finally {
        setLoading(false);
      }
    };
    if (activeProfileId) load();
  }, [activeProfileId]);

  useEffect(() => {
    if (originalConfig) {
      const keysToCheck = ['diesel_precio', 'mpg', 'seguro_semanal', 'lease_semanal', 'pago_conductor_porcentaje', 'otros_gastos_semanales', 'millas_semana_promedio', 'tarifa_objetivo', 'custom_accessorials_active', 'custom_accessorials_text'];
      const isUnsaved = keysToCheck.some(key => {
        let originalVal = originalConfig[key];
        if (originalVal === undefined) {
           const def = {
            diesel_precio: 5.40, mpg: 6.5, seguro_semanal: 800,
            lease_semanal: 1200, pago_conductor_porcentaje: 25,
            otros_gastos_semanales: 300, millas_semana_promedio: 2500, tarifa_objetivo: 3.0,
            custom_accessorials_active: false, custom_accessorials_text: ''
          };
          originalVal = def[key];
        }
        
        if (key === 'custom_accessorials_active' || key === 'custom_accessorials_text') {
           return config[key] !== originalVal;
        }
        return Number(config[key] || 0) !== Number(originalVal);
      });
      
      setUnsavedChanges('CostCalculator', isUnsaved);
    }
    return () => setUnsavedChanges('CostCalculator', false);
  }, [config, originalConfig, setUnsavedChanges]);

  const set = (key, val) => setConfig(prev => ({ ...prev, [key]: val }));

  // Cálculo — costMath.js es la fuente única de verdad (compartida con
  // Onboarding.jsx). `costos.valido` decide qué se muestra y si se puede
  // guardar; `breakEvenRate` usa un fallback seguro de 0 solo para que el
  // gráfico de barras no reciba NaN cuando es inválido — el texto de "Costo
  // por milla"/"Break-even" muestra "—" en ese caso, nunca el número crudo.
  const costos = deriveCosts(config);
  const costPerMile = costos.valido ? costos.costoPorMilla : null;
  const breakEvenRate = costos.valido ? costos.tarifaBreakEven : 0;
  const targetProfit = config.tarifa_objetivo - breakEvenRate;

  const quickloadProfit = QUICKLOAD_RATE - breakEvenRate;
  const quickloadStatus = quickloadProfit > 0.1 ? 'ganancia' : quickloadProfit > -0.1 ? 'break_even' : 'perdida';

  const keysToValidate = ['diesel_precio', 'mpg', 'millas_semana_promedio'];
  const hasZeroOrNegative = keysToValidate.some(key => Number(config[key]) <= 0);

  const saveConfig = async () => {
    // Si el cálculo sigue siendo inválido por alguna otra razón
    if (hasZeroOrNegative || !costos.valido) return;
    if (!costos.valido) return;
    setSaving(true);
    const user = await base44.auth.me();
    const data = {
      ...config,
      usuario: user.email,
      profile_id: activeProfileId,
      costo_por_milla: costos.costoPorMilla,
      tarifa_break_even: costos.tarifaBreakEven,
    };
    
    try {
      if (configId) {
        await base44.entities.CostConfig.update(configId, data);
      } else {
        const created = await base44.entities.CostConfig.create(data);
        setConfigId(created.id);
      }
      setOriginalConfig({ ...data });
      setUnsavedChanges('CostCalculator', false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Error guardando CostConfig:", e);
    } finally {
      setSaving(false);
    }
  };

  const barSegments = [
    { label: t.calculator.breakEvenLabel, rate: breakEvenRate, color: '#facc15' },
    { label: t.calculator.targetLabel, rate: Number(config.tarifa_objetivo), color: '#8b5cf6' },
    { label: t.calculator.marketLabel, rate: 3.10, color: '#a78bfa' },

  ];
  const maxRate = Math.max(...barSegments.map(s => s.rate), 4);

  if (loading) return <div className="flex justify-center items-center h-full"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Calculator className="w-5 h-5 text-primary" />
          {t.calculator.title}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t.calculator.subtitle}</p>
      </div>

      {/* Inputs */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">{t.calculator.variables}</h2>
        
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1 block"><Fuel className="w-3 h-3" />{t.calculator.diesel}</label>
            <input type="number" step="0.01" value={config.diesel_precio}
              onChange={e => set('diesel_precio', Number(e.target.value))}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t.calculator.mpg}</label>
            <input type="number" step="0.1" value={config.mpg}
              onChange={e => set('mpg', Number(e.target.value))}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t.calculator.insurance}</label>
            <input type="number" value={config.seguro_semanal}
              onChange={e => set('seguro_semanal', Number(e.target.value))}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t.calculator.lease}</label>
            <input type="number" value={config.lease_semanal}
              onChange={e => set('lease_semanal', Number(e.target.value))}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t.calculator.driverPay}</label>
            <input type="number" value={config.pago_conductor_porcentaje}
              onChange={e => set('pago_conductor_porcentaje', Number(e.target.value))}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t.calculator.otherCosts}</label>
            <input type="number" value={config.otros_gastos_semanales}
              onChange={e => set('otros_gastos_semanales', Number(e.target.value))}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t.calculator.weeklyMiles}</label>
            <input type="number" value={config.millas_semana_promedio}
              onChange={e => set('millas_semana_promedio', Number(e.target.value))}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t.calculator.targetRate}</label>
            <input type="number" step="0.01" value={config.tarifa_objetivo}
              onChange={e => set('tarifa_objetivo', Number(e.target.value))}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
        </div>
      </div>

      {/* Cargos Adicionales (Accessorials) */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Cargos Adicionales / Accesoriales</h2>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-muted-foreground">Activar personalizados</span>
            <div className="relative inline-flex items-center">
              <input type="checkbox" className="sr-only peer" checked={config.custom_accessorials_active} onChange={e => set('custom_accessorials_active', e.target.checked)} />
              <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
            </div>
          </label>
        </div>
        
        {config.custom_accessorials_active && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Ingresa tus cargos adicionales (uno por línea). El chat priorizará estos valores sobre los de mercado.<br/>
              Formato sugerido: <code>Concepto: $Monto</code> (Ej: <code>Pre-pull: $150</code>)
            </p>
            <textarea 
              value={config.custom_accessorials_text}
              onChange={e => set('custom_accessorials_text', e.target.value)}
              placeholder="Pre-pull: $150&#10;Chasis: $50 / día&#10;TONU: $200"
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50 min-h-[100px] resize-y"
            />
          </div>
        )}
      </div>

      {/* Results */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">{t.calculator.results}</h2>
        
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-xs text-muted-foreground">{t.calculator.costPerMile}</p>
            <p className="text-xl font-bold font-mono text-foreground mt-1">{costos.valido ? `$${costPerMile.toFixed(2)}` : '—'}</p>
            <p className="text-xs text-muted-foreground">{t.calculator.dieselFixed}</p>
          </div>
          <div className="bg-yellow-400/10 border border-yellow-400/20 rounded-xl p-3 text-center">
            <p className="text-xs text-yellow-400">{t.calculator.breakEven}</p>
            <p className="text-xl font-bold font-mono text-yellow-400 mt-1">{costos.valido ? `$${breakEvenRate.toFixed(2)}` : '—'}</p>
            <p className="text-xs text-muted-foreground">{t.calculator.minimumRate}</p>
          </div>
          <div className="bg-violet-400/10 border border-violet-400/20 rounded-xl p-3 text-center col-span-2 sm:col-span-1">
            <p className="text-xs text-violet-400">{t.calculator.target}</p>
            <p className="text-xl font-bold font-mono text-violet-400 mt-1">${Number(config.tarifa_objetivo).toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">+${targetProfit.toFixed(2)}/mi {t.calculator.profit}</p>
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

      </div>

      <div className="space-y-3">
        {hasZeroOrNegative && (
          <p className="text-sm text-red-500 font-medium text-center">
            Campos obligatorios
          </p>
        )}
        <button onClick={saveConfig} disabled={saving || hasZeroOrNegative}
          className="w-full py-3 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed text-sm font-semibold text-primary-foreground flex items-center justify-center gap-2 transition-all">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saved ? `✓ ${t.calculator.saved}` : t.calculator.save}
        </button>
      </div>
    </div>
  );
} 
