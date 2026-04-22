import { useState } from 'react';
import { X, TrendingUp, TrendingDown } from 'lucide-react';

const TIPO_OPTIONS = [
  { value: 'quickload', label: 'Quickload' },
  { value: 'broker_directo', label: 'Broker Directo' },
  { value: 'cliente_directo', label: 'Cliente Directo' },
];

const ESTADO_OPTIONS = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'en_transito', label: 'En Tránsito' },
  { value: 'entregado', label: 'Entregado' },
  { value: 'cancelado', label: 'Cancelado' },
];

export default function LoadForm({ load, onSave, onClose }) {
  const [form, setForm] = useState({
    origen: '', destino: '', millas: '', broker_nombre: '', tipo_cliente: 'broker_directo',
    tarifa_ofrecida: '', tarifa_negociada: '', diesel_precio_dia: 5.40,
    fecha_carga: '', fecha_entrega: '', truck_placa: '', conductor_nombre: '',
    estado: 'pendiente', notas: '', numero_referencia: '',
    ...load
  });

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  // Live calculations
  const millas = Number(form.millas) || 0;
  const tarifa = Number(form.tarifa_negociada) || 0;
  const diesel = Number(form.diesel_precio_dia) || 0;
  const rpm = millas > 0 && tarifa > 0 ? tarifa / millas : 0;
  const dieselCost = millas > 0 ? (millas / 6.5) * diesel : 0;
  const driverCut = tarifa * 0.25;
  const profit = tarifa - dieselCost - driverCut;
  const isProfit = profit > 50;
  const isLoss = profit < -50;

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">{load ? 'Editar Carga' : 'Nueva Carga'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Live calc preview */}
          {tarifa > 0 && millas > 0 && (
            <div className={`rounded-xl border p-3 flex items-center gap-3 ${
              isProfit ? 'bg-green-400/10 border-green-400/20' :
              isLoss ? 'bg-red-400/10 border-red-400/20' :
              'bg-yellow-400/10 border-yellow-400/20'
            }`}>
              {isProfit ? <TrendingUp className="w-5 h-5 text-green-400" /> : <TrendingDown className="w-5 h-5 text-red-400" />}
              <div className="flex-1 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">$/milla</p>
                  <p className={`text-sm font-bold font-mono ${rpm >= 3 ? 'text-green-400' : rpm >= 2.6 ? 'text-yellow-400' : 'text-red-400'}`}>${rpm.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Costo diesel</p>
                  <p className="text-sm font-bold font-mono text-foreground">${dieselCost.toFixed(0)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Ganancia est.</p>
                  <p className={`text-sm font-bold font-mono ${isProfit ? 'text-green-400' : 'text-red-400'}`}>${profit.toFixed(0)}</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Origen *</label>
              <input value={form.origen} onChange={e => set('origen', e.target.value)} required
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" placeholder="Miami, FL" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Destino *</label>
              <input value={form.destino} onChange={e => set('destino', e.target.value)} required
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" placeholder="Tampa, FL" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Millas</label>
              <input type="number" value={form.millas} onChange={e => set('millas', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" placeholder="275" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tarifa ofrecida $</label>
              <input type="number" step="0.01" value={form.tarifa_ofrecida} onChange={e => set('tarifa_ofrecida', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" placeholder="600" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tarifa negociada $</label>
              <input type="number" step="0.01" value={form.tarifa_negociada} onChange={e => set('tarifa_negociada', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" placeholder="750" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Precio diesel hoy $</label>
              <input type="number" step="0.01" value={form.diesel_precio_dia} onChange={e => set('diesel_precio_dia', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Broker</label>
              <input value={form.broker_nombre} onChange={e => set('broker_nombre', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" placeholder="Nombre del broker" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tipo</label>
              <select value={form.tipo_cliente} onChange={e => set('tipo_cliente', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50">
                {TIPO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Fecha carga</label>
              <input type="date" value={form.fecha_carga} onChange={e => set('fecha_carga', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Fecha entrega</label>
              <input type="date" value={form.fecha_entrega} onChange={e => set('fecha_entrega', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Estado</label>
              <select value={form.estado} onChange={e => set('estado', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50">
                {ESTADO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Placa camión</label>
              <input value={form.truck_placa} onChange={e => set('truck_placa', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" placeholder="ABC-1234" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Conductor</label>
              <input value={form.conductor_nombre} onChange={e => set('conductor_nombre', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" placeholder="Nombre del conductor" />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Notas</label>
            <textarea value={form.notas} onChange={e => set('notas', e.target.value)} rows={2}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none" />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Cancelar
            </button>
            <button type="submit" className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-sm font-semibold text-primary-foreground transition-all">
              Guardar carga
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}