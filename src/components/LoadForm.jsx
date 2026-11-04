import { useState, useEffect } from 'react';
import { X, TrendingUp, TrendingDown } from 'lucide-react';
import { useProfile } from '@/lib/ProfileContext';
import { useLanguage } from '@/lib/LanguageContext';
import DriverSelect, { canAssign } from '@/components/DriverSelect';
import { assignmentFields } from '@/lib/driverAssignment';

// M2 (QA): texto plano. Se quita cualquier etiqueta HTML (<img onerror=…>, <script>…)
// antes de guardar. React ya escapa al mostrar, pero no se debe almacenar marcado.
function plainText(v, max = 200) {
  return String(v ?? '')
    .replace(/<[^>]*>?/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, max);
}

export default function LoadForm({ load, onSave, onClose, driverOptions = [] }) {
  const { setUnsavedChanges } = useProfile();
  const { t, locale } = useLanguage();
  const isEs = locale !== 'en';

  const TIPO_OPTIONS = [
    { value: 'broker_directo', label: t.loadForm.directBroker },
    { value: 'cliente_directo', label: t.loadForm.directClient },
  ];

  const ESTADO_OPTIONS = [
    { value: 'pendiente', label: t.loadForm.pending },
    { value: 'en_transito', label: t.loadForm.inTransit },
    { value: 'entregado', label: t.loadForm.delivered },
    { value: 'cancelado', label: t.loadForm.cancelled },
  ];

  const initialState = {
    origen: '', destino: '', millas: '', broker_nombre: '', tipo_cliente: 'broker_directo',
    tarifa_ofrecida: '', tarifa_negociada: '', diesel_precio_dia: 5.40,
    fecha_carga: '', fecha_entrega: '', truck_placa: '', conductor_nombre: '',
    conductor_id: null, truck_id: null,
    estado: 'pendiente', notas: '', numero_referencia: '',
    ...load
  };
  
  const [form, setForm] = useState(initialState);
  const [errors, setErrors] = useState({});
  const [docAck, setDocAck] = useState(false);
  const selectedDriver = driverOptions.find(o => String(o.id) === String(form.conductor_id)) || null;

  useEffect(() => {
    const isUnsaved = JSON.stringify(form) !== JSON.stringify(initialState);
    setUnsavedChanges('LoadForm', isUnsaved);
    return () => setUnsavedChanges('LoadForm', false);
  }, [form, load, setUnsavedChanges]);

  const set = (key, val) => {
    setForm(prev => ({ ...prev, [key]: val }));
    if (errors[key]) {
      setErrors(prev => ({ ...prev, [key]: false }));
    }
  };

  // Live calculations
  const millas = Number(String(form.millas).replace(',', '.')) || 0;
  const tarifa = Number(form.tarifa_negociada) > 0 ? Number(form.tarifa_negociada) : (Number(form.tarifa_ofrecida) || 0);
  const diesel = Number(form.diesel_precio_dia) || 0;
  const rpm = millas > 0 && tarifa > 0 ? tarifa / millas : 0;
  const dieselCost = millas > 0 ? (millas / 6.5) * diesel : 0;
  const isGoodRpm = rpm >= 2.6;

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = {};
    if (!form.origen || !form.origen.trim()) newErrors.origen = true;
    if (!form.destino || !form.destino.trim()) newErrors.destino = true;
    // M1 (QA): millas > 0 y tarifas ≥ 0 (antes se guardaba −500 y contaminaba el Dashboard)
    const millasNum = Number(String(form.millas).replace(',', '.'));
    if (!Number.isFinite(millasNum) || millasNum <= 0) newErrors.millas = true;
    for (const k of ['tarifa_ofrecida', 'tarifa_negociada', 'diesel_precio_dia']) {
      const raw = form[k];
      if (raw === '' || raw === null || raw === undefined) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) newErrors[k] = true;
    }
    if (plainText(form.origen) === '') newErrors.origen = true;
    if (plainText(form.destino) === '') newErrors.destino = true;
    // Documento vencido (ej. TWIC): no se asigna sin confirmación explícita.
    if (!canAssign(selectedDriver, docAck)) newErrors.conductor_id = true;
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    onSave({
      ...form,
      origen: plainText(form.origen, 120),
      destino: plainText(form.destino, 120),
      broker_nombre: plainText(form.broker_nombre, 80),
      numero_referencia: plainText(form.numero_referencia, 60),
      notas: plainText(form.notas, 1000),
      millas: millasNum,
      tarifa_ofrecida: Number(form.tarifa_ofrecida) || 0,
      tarifa_negociada: Number(form.tarifa_negociada) || 0,
      diesel_precio_dia: Number(form.diesel_precio_dia) || 0,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {load?.id ? t.loadForm.editTitle : t.loadForm.newTitle}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="p-5 space-y-4">
          {/* Live calc preview */}
          {tarifa > 0 && millas > 0 && (
            <div className={`rounded-xl border p-3 flex items-center gap-3 ${
              isGoodRpm ? 'bg-green-400/10 border-green-400/20' : 'bg-yellow-400/10 border-yellow-400/20'
            }`}>
              {isGoodRpm ? <TrendingUp className="w-5 h-5 text-green-400" /> : <TrendingDown className="w-5 h-5 text-yellow-400" />}
              <div className="flex-1 grid grid-cols-2 gap-2 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">{t.loadForm.rpmPreview}</p>
                  <p className={`text-sm font-bold font-mono ${rpm >= 3 ? 'text-green-400' : rpm >= 2.6 ? 'text-yellow-400' : 'text-red-400'}`}>${rpm.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t.loadForm.dieselCost}</p>
                  <p className="text-sm font-bold font-mono text-foreground">${dieselCost.toFixed(0)}</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {t.loadForm.origin} {!form.origen?.trim() && <span className="text-red-500 font-bold">*</span>}
              </label>
              <input
                value={form.origen}
                onChange={e => set('origen', e.target.value)}
                className={`w-full bg-muted border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none transition-colors ${
                  errors.origen && !form.origen?.trim() ? 'border-red-500 focus:ring-1 focus:ring-red-500/50' : 'border-border focus:ring-1 focus:ring-primary/50'
                }`}
                placeholder="Miami, FL"
              />
              {errors.origen && !form.origen?.trim() && <span className="text-[10px] text-red-400 block mt-0.5">{t.loadForm.required}</span>}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {t.loadForm.destination} {!form.destino?.trim() && <span className="text-red-500 font-bold">*</span>}
              </label>
              <input
                value={form.destino}
                onChange={e => set('destino', e.target.value)}
                className={`w-full bg-muted border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none transition-colors ${
                  errors.destino && !form.destino?.trim() ? 'border-red-500 focus:ring-1 focus:ring-red-500/50' : 'border-border focus:ring-1 focus:ring-primary/50'
                }`}
                placeholder="Tampa, FL"
              />
              {errors.destino && !form.destino?.trim() && <span className="text-[10px] text-red-400 block mt-0.5">{t.loadForm.required}</span>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {t.loadForm.miles} {(!form.millas || String(form.millas).trim() === '') && <span className="text-red-500 font-bold">*</span>}
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={form.millas}
                onChange={e => {
                  const val = e.target.value;
                  if (/^[0-9]*[.,]?[0-9]*$/.test(val)) set('millas', val);
                }}
                className={`w-full bg-muted border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none transition-colors ${
                  errors.millas ? 'border-red-500 focus:ring-1 focus:ring-red-500/50' : 'border-border focus:ring-1 focus:ring-primary/50'
                }`}
                placeholder="275"
              />
              {errors.millas && (
                <span className="text-[10px] text-red-400 block mt-0.5 font-medium">
                  {!form.millas || String(form.millas).trim() === '' ? t.loadForm.required : (isEs ? 'Debe ser mayor que 0' : 'Must be greater than 0')}
                </span>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.loadForm.offeredRate}</label>
              <input type="number" step="0.01" min="0" value={form.tarifa_ofrecida} onChange={e => set('tarifa_ofrecida', e.target.value === '' ? '' : Number(e.target.value))}
                className={`w-full bg-muted border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 ${errors.tarifa_ofrecida ? 'border-red-500 focus:ring-red-500/50' : 'border-border focus:ring-primary/50'}`} placeholder="600" />
              {errors.tarifa_ofrecida && <span className="text-[10px] text-red-400 block mt-0.5">{isEs ? 'No puede ser negativa' : 'Cannot be negative'}</span>}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.loadForm.negotiatedRate}</label>
              <input type="number" step="0.01" min="0" value={form.tarifa_negociada} onChange={e => set('tarifa_negociada', e.target.value === '' ? '' : Number(e.target.value))}
                className={`w-full bg-muted border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 ${errors.tarifa_negociada ? 'border-red-500 focus:ring-red-500/50' : 'border-border focus:ring-primary/50'}`} placeholder="750" />
              {errors.tarifa_negociada && <span className="text-[10px] text-red-400 block mt-0.5">{isEs ? 'No puede ser negativa' : 'Cannot be negative'}</span>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.loadForm.dieselToday}</label>
              <input type="number" step="0.01" value={form.diesel_precio_dia} onChange={e => set('diesel_precio_dia', Number(e.target.value))}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.loadForm.broker}</label>
              <input value={form.broker_nombre} onChange={e => set('broker_nombre', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" placeholder={t.loadForm.brokerPlaceholder} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.loadForm.type}</label>
              <select value={form.tipo_cliente} onChange={e => set('tipo_cliente', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50">
                {TIPO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.loadForm.pickupDate}</label>
              <input type="date" value={form.fecha_carga} onChange={e => set('fecha_carga', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.loadForm.deliveryDate}</label>
              <input type="date" value={form.fecha_entrega} onChange={e => set('fecha_entrega', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.loadForm.status}</label>
              <select value={form.estado} onChange={e => set('estado', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50">
                {ESTADO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.loadForm.driver}</label>
              {/* Relación por ID: se elige de la lista de conductores del carrier activo */}
              <DriverSelect
                options={driverOptions}
                value={form.conductor_id}
                legacyName={!form.conductor_id ? form.conductor_nombre : ''}
                onChange={opt => {
                  setDocAck(false);
                  setForm(prev => ({ ...prev, ...assignmentFields(opt) }));
                  if (errors.conductor_id) setErrors(prev => ({ ...prev, conductor_id: false }));
                }}
                acknowledged={docAck}
                onAcknowledge={setDocAck}
                isEs={isEs}
              />
              {errors.conductor_id && (
                <p className="text-[11px] text-red-400 mt-1">
                  {isEs ? 'Confirma la advertencia del documento vencido para asignar.' : 'Confirm the expired-document warning to assign.'}
                </p>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.loadForm.truckPlate}</label>
              {/* La placa sale del camión del conductor elegido */}
              <input value={form.truck_placa || ''} readOnly
                className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
                placeholder={isEs ? 'Se completa al elegir conductor' : 'Filled when a driver is chosen'} />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t.loadForm.notes}</label>
            <textarea value={form.notas} onChange={e => set('notas', e.target.value)} rows={2}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none" />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              {t.loadForm.cancel}
            </button>
            <button type="submit" className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-sm font-semibold text-primary-foreground transition-all">
              {t.loadForm.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
