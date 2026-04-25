import { useState } from 'react';
import { ChevronRight, ChevronLeft, Plus, Trash2 } from 'lucide-react';

const PUERTOS = ['PortMiami', 'Port Everglades', 'Port of Palm Beach', 'Port of Jacksonville', 'Port Tampa Bay'];
const EQUIPMENT_OPTS = ['20ft Dry', '40ft Dry', '40ft HC', '45ft', '20ft Reefer', '40ft Reefer', 'Chassis Only'];
const CHASSIS_OPTS = ['20ft Pool', '40ft Pool', '45ft Pool', 'Tri-axle', 'Slider', 'Own Chassis'];
const LANE_OPTS = ['PortMiami → Doral', 'PortMiami → Hialeah', 'PEV → Miami', 'PEV → Doral', 'PortMiami → Broward', 'PEV → WPB'];

function MultiSelect({ options, selected, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(active ? selected.filter(s => s !== opt) : [...selected, opt])}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              active
                ? 'bg-primary/20 border-primary/50 text-primary'
                : 'bg-muted border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

const EMPTY_CARRIER = {
  company_name: '',
  mc_number: '',
  dot_number: '',
  equipment_types: [],
  chassis_types: [],
  ports_operated: [],
  commodity_restrictions: '',
  hazmat_allowed: false,
  overweight_allowed: false,
  reefer_allowed: false,
  power_only_allowed: false,
};

const STEPS = [
  { id: 'modo', title: 'Modo de despacho', subtitle: '¿Cómo trabajas?' },
  { id: 'carriers', title: 'Carriers gestionados', subtitle: 'Agrega los carriers con los que trabajas' },
  { id: 'lanes', title: 'Brokers y Lanes', subtitle: 'Brokers frecuentes y rutas habituales' },
];

export default function OnboardingDispatcher({ onComplete, onBack }) {
  const [step, setStep] = useState(0);
  const [dispatch_mode, setDispatchMode] = useState(null);
  const [carriers, setCarriers] = useState([{ ...EMPTY_CARRIER }]);
  const [editingCarrier, setEditingCarrier] = useState(0);
  const [lanes, setLanes] = useState([]);
  const [brokers_frecuentes, setBrokers] = useState('');

  const updateCarrier = (idx, key, val) => {
    setCarriers(prev => prev.map((c, i) => i === idx ? { ...c, [key]: val } : c));
  };

  const addCarrier = () => {
    setCarriers(prev => [...prev, { ...EMPTY_CARRIER }]);
    setEditingCarrier(carriers.length);
  };

  const removeCarrier = (idx) => {
    if (carriers.length === 1) return;
    setCarriers(prev => prev.filter((_, i) => i !== idx));
    setEditingCarrier(0);
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else onComplete({ dispatch_mode, carriers, lanes, brokers_frecuentes });
  };

  const current = STEPS[step];
  const carrier = carriers[editingCarrier] || carriers[0];

  return (
    <div className="space-y-5">
      {/* Progress */}
      <div className="flex gap-1.5">
        {STEPS.map((_, i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= step ? 'bg-primary' : 'bg-border'}`} />
        ))}
      </div>

      <div>
        <p className="text-xs text-primary font-semibold uppercase tracking-wider">{current.subtitle}</p>
        <h2 className="text-lg font-bold text-foreground mt-0.5">{current.title}</h2>
      </div>

      {/* Step 0: Modo */}
      {step === 0 && (
        <div className="space-y-3">
          {[
            { value: 'single_carrier', label: 'Un solo carrier', desc: 'Despacho siempre para el mismo carrier' },
            { value: 'multi_carrier', label: 'Múltiples carriers', desc: 'Gestiono varios carriers y asigno cargas entre ellos' },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => { setDispatchMode(opt.value); setStep(1); }}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 text-left transition-all group"
            >
              <div className="flex-1">
                <div className="text-sm font-semibold text-foreground">{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.desc}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary flex-shrink-0" />
            </button>
          ))}
          <button onClick={onBack} className="w-full text-xs text-muted-foreground hover:text-foreground mt-2 flex items-center justify-center gap-1">
            <ChevronLeft className="w-3 h-3" /> Atrás
          </button>
        </div>
      )}

      {/* Step 1: Carriers */}
      {step === 1 && (
        <div className="space-y-4">
          {/* Tabs si hay múltiples */}
          {carriers.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {carriers.map((c, i) => (
                <button
                  key={i}
                  onClick={() => setEditingCarrier(i)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    editingCarrier === i
                      ? 'bg-primary/20 border-primary/50 text-primary'
                      : 'bg-muted border-border text-muted-foreground'
                  }`}
                >
                  {c.company_name || `Carrier ${i + 1}`}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nombre legal *</label>
              <input
                value={carrier.company_name}
                onChange={e => updateCarrier(editingCarrier, 'company_name', e.target.value)}
                placeholder="ABC Trucking LLC"
                className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">MC Number</label>
                <input
                  value={carrier.mc_number}
                  onChange={e => updateCarrier(editingCarrier, 'mc_number', e.target.value)}
                  placeholder="MC-123456"
                  className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">DOT Number</label>
                <input
                  value={carrier.dot_number}
                  onChange={e => updateCarrier(editingCarrier, 'dot_number', e.target.value)}
                  placeholder="DOT-654321"
                  className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Puertos</label>
              <MultiSelect options={PUERTOS} selected={carrier.ports_operated} onChange={v => updateCarrier(editingCarrier, 'ports_operated', v)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Equipo</label>
              <MultiSelect options={EQUIPMENT_OPTS} selected={carrier.equipment_types} onChange={v => updateCarrier(editingCarrier, 'equipment_types', v)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Chasis</label>
              <MultiSelect options={CHASSIS_OPTS} selected={carrier.chassis_types} onChange={v => updateCarrier(editingCarrier, 'chassis_types', v)} />
            </div>
          </div>

          {/* Botones agregar/quitar carrier */}
          <div className="flex gap-2">
            {dispatch_mode === 'multi_carrier' && (
              <button onClick={addCarrier} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-primary/40 text-xs text-primary hover:bg-primary/5 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Agregar carrier
              </button>
            )}
            {carriers.length > 1 && (
              <button onClick={() => removeCarrier(editingCarrier)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-400/30 text-xs text-red-400 hover:bg-red-400/5 transition-colors">
                <Trash2 className="w-3.5 h-3.5" /> Quitar este
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Lanes y brokers */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Lanes frecuentes</label>
            <MultiSelect options={LANE_OPTS} selected={lanes} onChange={setLanes} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Brokers frecuentes (opcional)</label>
            <input
              value={brokers_frecuentes}
              onChange={e => setBrokers(e.target.value)}
              placeholder="Ej: XPO Logistics, Echo Global, Coyote"
              className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
        </div>
      )}

      {/* Nav (steps 1-2) */}
      {step > 0 && (
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => setStep(step - 1)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <ChevronLeft className="w-4 h-4" /> Atrás
          </button>
          <button
            onClick={next}
            disabled={step === 1 && !carrier.company_name.trim()}
            className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-40 text-sm font-semibold text-primary-foreground flex items-center justify-center gap-2 transition-all"
          >
            {step === STEPS.length - 1 ? 'Finalizar' : 'Continuar'}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}