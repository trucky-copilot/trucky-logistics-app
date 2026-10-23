import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Plus, Package, Trash2, Pencil } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import LoadForm from '@/components/LoadForm';
import DeleteConfirmModal from '@/components/DeleteConfirmModal';
import { useOrganizationId } from '@/lib/AppStateContext';
import { useLanguage } from '@/lib/LanguageContext';
import { listByOrg, withOrg } from '@/lib/orgScope';
import { useProfile } from '@/lib/ProfileContext';
import { useDemo } from '@/lib/DemoContext';
import DemoLimitModal from '@/components/DemoLimitModal';

export default function Loads() {
  const orgId = useOrganizationId();
  const { t, locale } = useLanguage();
  const { activeProfileId } = useProfile();
  const { isDemoUser, limits } = useDemo();
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [editLoad, setEditLoad] = useState(null);
  const [deleteLoad, setDeleteLoad] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [filter, setFilter] = useState('all');

  const getProfileLoadIds = () => {
    const key = `profile_loads_${orgId}_${activeProfileId}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  };

  const addLoadToProfile = (loadId) => {
    const key = `profile_loads_${orgId}_${activeProfileId}`;
    const current = getProfileLoadIds() || [];
    localStorage.setItem(key, JSON.stringify([...current, loadId]));
  };

  const handleDeleteLoad = async () => {
    if (!deleteLoad) return;
    try {
      setDeleteLoading(true);
      await base44.entities.Load.delete(deleteLoad.id);
      const key = `profile_loads_${orgId}_${activeProfileId}`;
      const current = getProfileLoadIds() || [];
      localStorage.setItem(key, JSON.stringify(current.filter(id => id !== deleteLoad.id)));
      setDeleteLoad(null);
      loadData();
    } catch (err) {
      console.error('Error eliminando carga:', err);
      alert('Error al eliminar la carga: ' + (err?.message || 'intente de nuevo'));
    } finally {
      setDeleteLoading(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    const data = await listByOrg(base44.entities.Load, orgId, '-created_date', 100);
    const profileIds = getProfileLoadIds();

    // Prioridad 1 (Backend): si los registros tienen profile_id guardado en Base44, filtrar directamente por él
    // Prioridad 2 (Legacy): usar el array de localStorage si aún no se ha migrado
    let filtered = data.filter(l => {
      if (l.profile_id) {
        return l.profile_id === activeProfileId;
      }
      return Boolean(profileIds && profileIds.includes(l.id));
    });

    setLoads(filtered);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [orgId, activeProfileId]);

  const filtered = filter === 'all' ? loads : loads.filter(l => l.tipo_cliente === filter || l.estado === filter || l.resultado === filter);

  const handleSave = async (data) => {
    try {
      // Calculamos campos derivados
      const rpm = data.millas > 0 && data.tarifa_negociada > 0 ? data.tarifa_negociada / data.millas : 0;
      const dieselCost = data.millas > 0 && data.diesel_precio_dia > 0 ? (data.millas / 6.5) * data.diesel_precio_dia : 0;
      const profit = data.tarifa_negociada - dieselCost - (data.tarifa_negociada * 0.25);
      const resultado = profit > 50 ? 'ganancia' : profit < -50 ? 'perdida' : 'break_even';

      const payload = { 
        ...data, 
        profile_id: activeProfileId, 
        revenue_por_milla: rpm, 
        costo_estimado: dieselCost, 
        ganancia_estimada: profit, 
        resultado 
      };

      if (editLoad) {
        await base44.entities.Load.update(editLoad.id, payload);
      } else {
        const created = await base44.entities.Load.create(withOrg(orgId, payload));
        addLoadToProfile(created.id);
      }
      setShowForm(false);
      setEditLoad(null);
      loadData();
    } catch (err) {
      console.error('Error guardando carga:', err);
      alert('Error al guardar la carga: ' + (err?.message || 'intente de nuevo'));
    }
  };

  const handleEdit = (load) => {
    setEditLoad(load);
    setShowForm(true);
  };

  const totalRevenue = filtered.reduce((s, l) => s + (l.tarifa_negociada || 0), 0);
  const totalMiles = filtered.reduce((s, l) => s + (l.millas || 0), 0);
  const avgRate = totalMiles > 0 ? totalRevenue / totalMiles : 0;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">{t.loadsPage.title}</h1>
          <p className="text-sm text-muted-foreground">{loads.length} {t.loadsPage.registered}</p>
        </div>
        <button
          onClick={() => {
            if (isDemoUser && loads.length >= (limits?.LOADS || 3)) {
              setShowLimitModal(true);
              return;
            }
            setEditLoad(null); 
            setShowForm(true); 
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          {t.loadsPage.add}
        </button>
      </div>

      <DemoLimitModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        entityName="cargas"
        limit={limits?.LOADS || 3}
      />

      {/* Summary strip - Ganancia estimada removida */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: t.loadsPage.revenue, value: `$${totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}` },
          { label: t.loadsPage.shown, value: filtered.length },
          { label: t.loadsPage.avgRate, value: totalMiles > 0 ? `$${avgRate.toFixed(2)}` : '--' },
        ].map((item, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-3">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="text-base font-bold font-mono mt-0.5 text-foreground">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-1.5 flex-wrap">
        {[
          { key: 'all', label: t.loadsPage.all }, { key: 'en_transito', label: t.loadsPage.inTransit },
          { key: 'pendiente', label: t.loadsPage.pending }, { key: 'entregado', label: t.loadsPage.delivered },
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
          <p className="text-sm">{t.loadsPage.noMatches}</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr className="text-xs text-muted-foreground">
                  <th className="text-left px-4 py-3 font-medium">{t.loadsPage.route}</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">{t.loadsPage.broker}</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">{t.loadsPage.type}</th>
                  <th className="text-right px-4 py-3 font-medium hidden md:table-cell">{t.loadsPage.miles}</th>
                  <th className="text-right px-4 py-3 font-medium">$/mi</th>
                  <th className="text-right px-4 py-3 font-medium">{t.loadsPage.total}</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">{t.loadsPage.status}</th>
                  <th className="px-4 py-3"></th>
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
                    <td className="px-4 py-3 hidden sm:table-cell"><StatusBadge status={load.estado || 'pendiente'} /></td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => handleEdit(load)}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                          title={locale === 'en' ? 'Edit' : 'Editar'}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteLoad(load)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                          title={locale === 'en' ? 'Delete' : 'Eliminar'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DeleteConfirmModal
        isOpen={!!deleteLoad}
        title={locale === 'en' ? 'Do you want to delete this Load?' : '¿Desea eliminar la Carga?'}
        subtitle={deleteLoad ? `${deleteLoad.origen} → ${deleteLoad.destino}` : ''}
        onConfirm={handleDeleteLoad}
        onClose={() => setDeleteLoad(null)}
        loading={deleteLoading}
        confirmText={locale === 'en' ? 'Delete' : 'Eliminar'}
        cancelText={locale === 'en' ? 'Cancel' : 'Cancelar'}
      />
    </div>
  );
}