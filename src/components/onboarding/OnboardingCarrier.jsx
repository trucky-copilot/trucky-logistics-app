import { useState } from 'react';
import { ChevronRight, ChevronLeft, Check } from 'lucide-react';

const PUERTOS = ['PortMiami', 'Port Everglades', 'Port of Palm Beach', 'Port of Jacksonville', 'Port Tampa Bay'];
const EQUIPMENT_OPTS = ['20ft Dry', '40ft Dry', '40ft HC', '45ft', '20ft Reefer', '40ft Reefer', 'Chassis Only'];
const CHASSIS_OPTS = ['20ft Pool', '40ft Pool', '45ft Pool', 'Tri-axle', 'Slider', 'Own Chassis'];
const LANE_OPTS = ['PortMiami → Doral', 'PortMiami → Hialeah', 'PEV → Miami', 'PEV → Doral', 'PortMiami → Broward', 'PEV → WPB'];

function MultiSelect({ options, selected, onChange, placeholder }) {
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

function Toggle({ label, desc, value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
        value ? 'bg-primary/10 border-primary/40 text-primary' : 'bg-muted border-border text-muted-foreground'
      }`}
    >
      <div className="text-left">
        <div className="text-sm font-semibold">{label}</div>
        {desc && <div className="text-xs opacity-70">{desc}</div>}
      </div>
      <div className={`w-10 h-5 rounded-full transition-all flex items-center px-0.5 ${value ? 'bg-primary' : 'bg-border'}`}>
        <div className={`w-4 h-4 rounded-full bg-white transition-all ${value ? 'translate-x-5' : 'translate-x-0'}`} />
      </div>
    </button>
  );
}

const STEPS = [
  { id: 'identidad', title: 'Tu empresa', subtitle: 'Datos legales del carrier' },
  { id: 'operacion', title: 'Operación', subtitle: 'Puertos, equipo y chasis' },
  { id: 'capacidades', title: 'Capacidades', subtitle: 'Qué tipo de carga puedes mover' },
  { id: 'costos', title: 'Configurar costos', subtitle: '¿Quieres ingresar tus costos ahora?' },
];

export default function OnboardingCarrier({ onComplete, onBack }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState({
    company_name: '',
    trade_name: '',
    mc_number: '',
    dot_number: '',
    ports_operated: [],
    equipment_types: [],
    chassis_types: [],
    hazmat_allowed: false,
    overweight_allowed: false,
    reefer_allowed: false,
    power_only_allowed: false,
    commodity_restrictions: '',
    twic_required: true,
    lanes: [],
    configurar_costos: false,
  });

  const set = (key, val) => setData(prev => ({ ...prev, [key]: val }));

  const canContinue = () => {
    if (step === 0) return data.company_name.trim().length > 0;
    return true;
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else onComplete(data);
  };

  const current = STEPS[step];

  return (
    <div className="space-y-5">
      {/* Progress */}
      <div className="flex gap-1.5">
        {STEPS.map((s, i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= step ? 'bg-primary' : 'bg-border'}`} />
        ))}
      </div>

      <div>
        <p className="text-xs text-primary font-semibold uppercase tracking-wider">{current.subtitle}</p>
        <h2 className="text-lg font-bold text-foreground mt-0.5">{current.title}</h2>
      </div>

      {/* Step 0: Identidad */}
      {step === 0 && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nombre legal de la empresa *</label>
            <input
              value={data.company_name}
              onChange={e => set('company_name', e.target.value)}
              placeholder="Ej. ABC Trucking LLC"
              className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nombre comercial / DBA</label>
            <input
              value={data.trade_name}
              onChange={e => set('trade_name', e.target.value)}
              placeholder="Ej. ABC Transport"
              className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">MC Number</label>
              <input
                value={data.mc_number}
                onChange={e => set('mc_number', e.target.value)}
                placeholder="MC-123456"
                className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">DOT Number</label>
              <input
                value={data.dot_number}
                onChange={e => set('dot_number', e.target.value)}
                placeholder="DOT-654321"
                className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Operación */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Puertos donde operas</label>
            <MultiSelect options={PUERTOS} selected={data.ports_operated} onChange={v => set('ports_operated', v)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Tipos de equipo / contenedor</label>
            <MultiSelect options={EQUIPMENT_OPTS} selected={data.equipment_types} onChange={v => set('equipment_types', v)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Tipos de chasis</label>
            <MultiSelect options={CHASSIS_OPTS} selected={data.chassis_types} onChange={v => set('chassis_types', v)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Lanes frecuentes</label>
            <MultiSelect options={LANE_OPTS} selected={data.lanes} onChange={v => set('lanes', v)} />
          </div>
        </div>
      )}

      {/* Step 2: Capacidades */}
      {step === 2 && (
        <div className="space-y-3">
          <Toggle label="HAZMAT" desc="Carga peligrosa con endoso" value={data.hazmat_allowed} onChange={v => set('hazmat_allowed', v)} />
          <Toggle label="Overweight / Oversize" desc="Cargas con permisos de sobrepeso" value={data.overweight_allowed} onChange={v => set('overweight_allowed', v)} />
          <Toggle label="Refrigerado (Reefer)" desc="Contenedores refrigerados" value={data.reefer_allowed} onChange={v => set('reefer_allowed', v)} />
          <Toggle label="Power Only" desc="Mover chasis de otros sin contenedor propio" value={data.power_only_allowed} onChange={v => set('power_only_allowed', v)} />
          <Toggle label="TWIC requerido" desc="¿Tus operaciones requieren TWIC card?" value={data.twic_required} onChange={v => set('twic_required', v)} />
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Restricciones de commodity (opcional)</label>
            <input
              value={data.commodity_restrictions}
              onChange={e => set('commodity_restrictions', e.target.value)}
              placeholder="Ej: alcohol, tobacco, explosives"
              className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
        </div>
      )}

      {/* Step 3: Costos */}
      {step === 3 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Configurar tus costos permite que el verificador calcule automáticamente si una tarifa es rentable.</p>
          <button
            onClick={() => { set('configurar_costos', true); onComplete({ ...data, configurar_costos: true }); }}
            className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 text-left transition-all group"
          >
            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center group-hover:bg-primary/10">
              <Check className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Configurar costos ahora</div>
              <div className="text-xs text-muted-foreground">Ir a la calculadora después de guardar</div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary ml-auto" />
          </button>
          <button
            onClick={() => onComplete({ ...data, configurar_costos: false })}
            className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 text-left transition-all group"
          >
            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center group-hover:bg-primary/10">
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Lo hago después</div>
              <div className="text-xs text-muted-foreground">Entrar al dashboard primero</div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary ml-auto" />
          </button>
        </div>
      )}

      {/* Nav buttons (steps 0-2) */}
      {step < 3 && (
        <div className="flex gap-2 pt-2">
          <button
            onClick={step === 0 ? onBack : () => setStep(step - 1)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
            Atrás
          </button>
          <button
            onClick={next}
            disabled={!canContinue()}
            className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-40 text-sm font-semibold text-primary-foreground flex items-center justify-center gap-2 transition-all"
          >
            {step === STEPS.length - 2 ? 'Finalizar' : 'Continuar'}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}