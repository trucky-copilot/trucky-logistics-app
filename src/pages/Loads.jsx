import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Plus, Package } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import LoadForm from '@/components/LoadForm';
import { useOrganizationId } from '@/lib/AppStateContext';
import { listByOrg, withOrg } from '@/lib/orgScope';

export default function Loads() {
  const orgId = useOrganizationId();
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editLoad, setEditLoad] = useState(null);
  const [filter, setFilter] = useState('all');

  const loadData = async () => {
    const data = await listByOrg(base44.entities.Load, orgId, '-created_date', 100);
    setLoads(data);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [orgId]);

  const filtered = filter === 'all' ? loads : loads.filter(l => l.tipo_cliente === filter || l.estado === filter || l.resultado === filter);

  const handleSave = async (data) => {
    // Calculate derived fields
    const rpm = data.millas > 0 && data.tarifa_negociada > 0 ? data.tarifa_negociada / data.millas : 0;
    const dieselCost = data.millas > 0 && data.diesel_precio_dia > 0 ? (data.millas / 6.5) * data.diesel_precio_dia : 0;
    const profit = data.tarifa_negociada - dieselCost - (data.tarifa_negociada * 0.25);
    const resultado = profit > 50 ? 'ganancia' : profit < -50 ? 'perdida' : 'break_even';

    const payload = { ...data, revenue_por_milla: rpm, costo_estimado: dieselCost, ganancia_estimada: profit, resultado };

    if (editLoad) {
      await base44.entities.Load.update(editLoad.id, payload);
    } else {
      await base44.entities.Load.create(withOrg(orgId, payload));
    }
    setShowForm(false);
    setEditLoad(null);
    loadData();
  };

  const handleEdit = (load) => {
    setEditLoad(load);
    setShowForm(true);
  };

  const totalRevenue = filtered.reduce((s, l) => s + (l.tarifa_negociada || 0), 0);
  const totalProfit = filtered.reduce((s, l) => s + (l.ganancia_estimada || 0), 0);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Cargas</h1>
          <p className="text-sm text-muted-foreground">{loads.length} registradas</p>
        </div>
        <button
          onClick={() => { setEditLoad(null); setShowForm(true); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          Nueva carga
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total facturado', value: `$${totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}` },
          { label: 'Ganancia estimada', value: `$${totalProfit.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, color: totalProfit >= 0 ? 'text-green-400' : 'text-red-400' },
          { label: 'Cargas mostradas', value: filtered.length },
          { label: '$/mi promedio', value: filtered.length > 0 ? `$${(filtered.reduce((s, l) => s + (l.revenue_por_milla || 0), 0) / filtered.filter(l => l.revenue_por_milla).length || 0).toFixed(2)}` : '--' },
        ].map((item, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-3">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className={`text-base font-bold font-mono mt-0.5 ${item.color || 'text-foreground'}`}>{item.value}</p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-1.5 flex-wrap">
        {[
          { key: 'all', label: 'Todas' },
          { key: 'en_transito', label: 'En tránsito' },
          { key: 'pendiente', label: 'Pendientes' },
          { key: 'entregado', label: 'Entregadas' },
          { key: 'quickload', label: 'Quickload' },
          { key: 'ganancia', label: '🟢 Ganancia' },
          { key: 'perdida', label: '🔴 Pérdida' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === f.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Form modal */}
      {showForm && (
        <LoadForm
          load={editLoad}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditLoad(null); }}
        />
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No hay cargas con este filtro</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr className="text-xs text-muted-foreground">
                  <th className="text-left px-4 py-3 font-medium">Ruta</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Broker</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Tipo</th>
                  <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Millas</th>
                  <th className="text-right px-4 py-3 font-medium">$/mi</th>
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                  <th className="text-right px-4 py-3 font-medium">Ganancia</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Estado</th>
                  <th className="text-left px-4 py-3 font-medium">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered.map(load => (
                  <tr key={load.id} className="hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => handleEdit(load)}>
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium text-foreground">{load.origen}</div>
                      <div className="text-xs text-muted-foreground">→ {load.destino}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden sm:table-cell">{load.broker_nombre || '--'}</td>
                    <td className="px-4 py-3 hidden md:table-cell"><StatusBadge status={load.tipo_cliente || 'broker_directo'} /></td>
                    <td className="px-4 py-3 text-right text-xs font-mono text-muted-foreground hidden md:table-cell">{load.millas || '--'}</td>
                    <td className={`px-4 py-3 text-right text-xs font-mono font-semibold ${
                      (load.revenue_por_milla || 0) >= 3 ? 'text-green-400' : 
                      (load.revenue_por_milla || 0) >= 2.6 ? 'text-yellow-400' : 'text-red-400'
                    }`}>${load.revenue_por_milla?.toFixed(2) || '--'}</td>
                    <td className="px-4 py-3 text-right text-xs font-mono text-foreground">${(load.tarifa_negociada || 0).toLocaleString()}</td>
                    <td className={`px-4 py-3 text-right text-xs font-mono font-semibold ${
                      (load.ganancia_estimada || 0) > 0 ? 'text-green-400' : 'text-red-400'
                    }`}>${(load.ganancia_estimada || 0).toFixed(0)}</td>
                    <td className="px-4 py-3 hidden sm:table-cell"><StatusBadge status={load.estado || 'pendiente'} /></td>
                    <td className="px-4 py-3"><StatusBadge status={load.resultado || 'break_even'} /></td>
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