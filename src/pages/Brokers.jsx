import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Building2, Plus, X, Pencil, Star } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';

function ScoreDots({ score, max = 10 }) {
  const filled = Math.round((score || 0));
  const color = filled >= 7 ? 'bg-green-400' : filled >= 5 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className={`w-2 h-2 rounded-full ${i < filled ? color : 'bg-muted'}`} />
      ))}
    </div>
  );
}

function BrokerForm({ broker, onSave, onClose }) {
  const [form, setForm] = useState({
    nombre: '', mc_number: '', contacto: '', telefono: '', email: '',
    tarifa_promedio: '', dias_pago: 30, puntaje_confiabilidad: 7,
    puntaje_pago: 7, clausulas_frecuentes: '', notas: '', estado: 'activo',
    ...broker
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const handleSubmit = (e) => { e.preventDefault(); onSave(form); };
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">{broker ? 'Editar Broker' : 'Nuevo Broker'}</h2>
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
              <label className="text-xs text-muted-foreground mb-1 block">MC Number</label>
              <input value={form.mc_number} onChange={e => set('mc_number', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Contacto</label>
              <input value={form.contacto} onChange={e => set('contacto', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Teléfono</label>
              <input value={form.telefono} onChange={e => set('telefono', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tarifa prom $/mi</label>
              <input type="number" step="0.01" value={form.tarifa_promedio} onChange={e => set('tarifa_promedio', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Días de pago</label>
              <input type="number" value={form.dias_pago} onChange={e => set('dias_pago', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Estado</label>
              <select value={form.estado} onChange={e => set('estado', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50">
                {['activo','precaucion','bloqueado'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Confiabilidad (1-10)</label>
              <input type="number" min="1" max="10" value={form.puntaje_confiabilidad} onChange={e => set('puntaje_confiabilidad', Number(e.target.value))}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Pago puntual (1-10)</label>
              <input type="number" min="1" max="10" value={form.puntaje_pago} onChange={e => set('puntaje_pago', Number(e.target.value))}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Cláusulas frecuentes / alertas</label>
            <textarea value={form.clausulas_frecuentes} onChange={e => set('clausulas_frecuentes', e.target.value)} rows={2}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none" />
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

export default function Brokers() {
  const [brokers, setBrokers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editBroker, setEditBroker] = useState(null);

  const loadData = async () => {
    const data = await base44.entities.Broker.list();
    setBrokers(data);
    setLoading(false);
  };
  useEffect(() => { loadData(); }, []);

  const handleSave = async (data) => {
    if (editBroker) await base44.entities.Broker.update(editBroker.id, data);
    else await base44.entities.Broker.create(data);
    setShowForm(false); setEditBroker(null); loadData();
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Brokers</h1>
          <p className="text-sm text-muted-foreground">{brokers.length} registrados</p>
        </div>
        <button onClick={() => { setEditBroker(null); setShowForm(true); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground">
          <Plus className="w-3.5 h-3.5" />Agregar broker
        </button>
      </div>

      {showForm && <BrokerForm broker={editBroker} onSave={handleSave} onClose={() => { setShowForm(false); setEditBroker(null); }} />}

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : brokers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No hay brokers registrados</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr className="text-xs text-muted-foreground">
                  <th className="text-left px-4 py-3 font-medium">Broker</th>
                  <th className="text-center px-4 py-3 font-medium hidden sm:table-cell">Cargas</th>
                  <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">$/mi prom</th>
                  <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Días pago</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Confiabilidad</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Pago puntual</th>
                  <th className="text-left px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {brokers.sort((a, b) => (b.cargas_realizadas || 0) - (a.cargas_realizadas || 0)).map(broker => (
                  <tr key={broker.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{broker.nombre}</div>
                      <div className="text-xs text-muted-foreground">{broker.mc_number || 'Sin MC'} · {broker.contacto || 'Sin contacto'}</div>
                      {broker.clausulas_frecuentes && (
                        <div className="text-xs text-yellow-400 mt-0.5 truncate max-w-48">⚠ {broker.clausulas_frecuentes}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-foreground font-mono hidden sm:table-cell">{broker.cargas_realizadas || 0}</td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold hidden sm:table-cell ${
                      (broker.tarifa_promedio || 0) >= 3 ? 'text-green-400' : (broker.tarifa_promedio || 0) >= 2.6 ? 'text-yellow-400' : 'text-red-400'
                    }`}>${broker.tarifa_promedio?.toFixed(2) || '--'}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">Net {broker.dias_pago || '--'}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <ScoreDots score={broker.puntaje_confiabilidad} />
                      <span className="text-xs text-muted-foreground">{broker.puntaje_confiabilidad || '--'}/10</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <ScoreDots score={broker.puntaje_pago} />
                      <span className="text-xs text-muted-foreground">{broker.puntaje_pago || '--'}/10</span>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={broker.estado} /></td>
                    <td className="px-4 py-3">
                      <button onClick={() => { setEditBroker(broker); setShowForm(true); }}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}