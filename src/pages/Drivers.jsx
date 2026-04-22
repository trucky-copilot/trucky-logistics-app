import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Users, Plus, X, Pencil, AlertTriangle, CheckCircle2 } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';

function DocAlert({ label, date }) {
  if (!date) return null;
  const today = new Date();
  const exp = new Date(date);
  const diff = Math.floor((exp - today) / (1000 * 60 * 60 * 24));
  if (diff > 60) return null;
  const expired = diff < 0;
  return (
    <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md ${expired ? 'bg-red-400/10 text-red-400' : 'bg-yellow-400/10 text-yellow-400'}`}>
      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
      {label}: {expired ? `VENCIDO ${Math.abs(diff)}d` : `vence en ${diff}d`}
    </div>
  );
}

function DriverForm({ driver, onSave, onClose }) {
  const [form, setForm] = useState({
    nombre: '', apellido: '', telefono: '', licencia_numero: '',
    licencia_vencimiento: '', medico_vencimiento: '', twic_vencimiento: '',
    hazmat_vencimiento: '', estado: 'activo', truck_asignado: '', notas: '',
    ...driver
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const handleSubmit = (e) => { e.preventDefault(); onSave(form); };
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">{driver ? 'Editar Conductor' : 'Nuevo Conductor'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nombre *</label>
              <input required value={form.nombre} onChange={e => set('nombre', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Apellido</label>
              <input value={form.apellido} onChange={e => set('apellido', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Teléfono</label>
              <input value={form.telefono} onChange={e => set('telefono', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Estado</label>
              <select value={form.estado} onChange={e => set('estado', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50">
                {['activo','inactivo','vacaciones','suspension'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Licencia CDL #</label>
              <input value={form.licencia_numero} onChange={e => set('licencia_numero', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Vencimiento licencia</label>
              <input type="date" value={form.licencia_vencimiento} onChange={e => set('licencia_vencimiento', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Médico vence</label>
              <input type="date" value={form.medico_vencimiento} onChange={e => set('medico_vencimiento', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">TWIC vence</label>
              <input type="date" value={form.twic_vencimiento} onChange={e => set('twic_vencimiento', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">HazMat vence</label>
              <input type="date" value={form.hazmat_vencimiento} onChange={e => set('hazmat_vencimiento', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Camión asignado (placa)</label>
            <input value={form.truck_asignado} onChange={e => set('truck_asignado', e.target.value)}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Notas</label>
            <textarea value={form.notas} onChange={e => set('notas', e.target.value)} rows={2}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground">Cancelar</button>
            <button type="submit" className="flex-1 py-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground">Guardar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Drivers() {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editDriver, setEditDriver] = useState(null);

  const loadData = async () => {
    const data = await base44.entities.Driver.list();
    setDrivers(data);
    setLoading(false);
  };
  useEffect(() => { loadData(); }, []);

  const handleSave = async (data) => {
    if (editDriver) await base44.entities.Driver.update(editDriver.id, data);
    else await base44.entities.Driver.create(data);
    setShowForm(false); setEditDriver(null); loadData();
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Conductores</h1>
          <p className="text-sm text-muted-foreground">{drivers.length} registrados</p>
        </div>
        <button onClick={() => { setEditDriver(null); setShowForm(true); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground">
          <Plus className="w-3.5 h-3.5" />Agregar conductor
        </button>
      </div>

      {showForm && <DriverForm driver={editDriver} onSave={handleSave} onClose={() => { setShowForm(false); setEditDriver(null); }} />}

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : drivers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No hay conductores registrados</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {drivers.map(driver => (
            <div key={driver.id} className="bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-colors">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-semibold text-foreground">{driver.nombre} {driver.apellido || ''}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{driver.telefono || 'Sin teléfono'}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusBadge status={driver.estado} />
                  <button onClick={() => { setEditDriver(driver); setShowForm(true); }}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {driver.truck_asignado && (
                <div className="text-xs text-muted-foreground mb-2">Camión: <span className="text-foreground font-mono">{driver.truck_asignado}</span></div>
              )}
              <div className="space-y-1">
                <DocAlert label="Licencia" date={driver.licencia_vencimiento} />
                <DocAlert label="Médico" date={driver.medico_vencimiento} />
                <DocAlert label="TWIC" date={driver.twic_vencimiento} />
                <DocAlert label="HazMat" date={driver.hazmat_vencimiento} />
                {!driver.licencia_vencimiento && !driver.medico_vencimiento && !driver.twic_vencimiento && (
                  <div className="flex items-center gap-1 text-xs text-green-400">
                    <CheckCircle2 className="w-3 h-3" />
                    Documentos al día
                  </div>
                )}
              </div>
              {driver.notas && <p className="text-xs text-muted-foreground/70 italic mt-2 truncate">{driver.notas}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}