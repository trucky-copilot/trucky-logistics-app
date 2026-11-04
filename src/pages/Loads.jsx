import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Plus, Package, Trash2, Pencil, UserCheck } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import LoadForm from '@/components/LoadForm';
import DeleteConfirmModal from '@/components/DeleteConfirmModal';
import { useOrganizationId, useAppState } from '@/lib/AppStateContext';
import { useLanguage } from '@/lib/LanguageContext';
import { listByOrg, withOrg } from '@/lib/orgScope';
import { useProfile } from '@/lib/ProfileContext';
import { useDemo } from '@/lib/DemoContext';
import DemoLimitModal from '@/components/DemoLimitModal';
import { useToast } from '@/components/ui/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { onlyActiveProfile, buildDriverOptions, storeDispatchDraft } from '@/lib/driverAssignment';
import { AUTOMATION_CHECKER_TO_LOAD_KEY } from '@/lib/dispatchAutomation';
import { effectiveRate, effectiveRpm, estimateProfit } from '@/lib/loadRate';

export default function Loads() {
  const orgId = useOrganizationId();
  const { t, locale } = useLanguage();
  const { activeProfileId } = useProfile();
  const { limits } = useDemo();
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [editLoad, setEditLoad] = useState(null);
  const [deleteLoad, setDeleteLoad] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [drivers, setDrivers] = useState([]);
  const [myAssignedLoads, setMyAssignedLoads] = useState([]);
  const [prefillLoad, setPrefillLoad] = useState(null);

  // Viene del Verificador: abrir el formulario PRE-LLENADO para que el dispatcher
  // revise y confirme. La carga no se crea hasta que pulse Guardar.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(AUTOMATION_CHECKER_TO_LOAD_KEY);
      if (!raw) return;
      sessionStorage.removeItem(AUTOMATION_CHECKER_TO_LOAD_KEY);
      const d = JSON.parse(raw) || {};
      const num = (v) => (Number(v) > 0 ? Number(v) : '');
      setPrefillLoad({
        origen: d.origen || '',
        destino: d.destino || '',
        millas: num(d.millas),
        broker_nombre: d.broker_nombre || '',
        broker_email: d.broker_email || '',
        tarifa_ofrecida: num(d.tarifa_ofrecida),
        tarifa_negociada: num(d.tarifa_negociada),
        fecha_carga: d.fecha_carga || '',
        fecha_entrega: d.fecha_entrega || '',
        citas: d.citas || '',
        numero_referencia: d.numero_referencia || '',
        notas: d.notas || '',
        thread_id: d.thread_id || '',
        estado: 'pendiente',
      });
      setEditLoad(null);
      setShowForm(true);
    } catch (_) {}
  }, []);
  const [trucks, setTrucks] = useState([]);
  const { currentUser } = useAppState();
  const { toast } = useToast();
  const navigate = useNavigate();
  const isEs = locale !== 'en';

  const legacyIds = (entity) => {
    try { return JSON.parse(localStorage.getItem(`profile_${entity}_${orgId}_${activeProfileId}`) || 'null'); }
    catch (_) { return null; }
  };

  const getProfileLoadIds = () => {
    const key = `profile_loads_${orgId}_${activeProfileId}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  };

  const addLoadToProfile = (loadId) => {
    const key = `profile_loads_${orgId}_${activeProfileId}`;
    const current = getProfileLoadIds() || [];
    if (!current.includes(loadId)) {
      localStorage.setItem(key, JSON.stringify([...current, loadId]));
    }
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
      window.dispatchEvent(new CustomEvent('notifications-updated'));
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
    const [data, rawDrivers, rawTrucks] = await Promise.all([
      listByOrg(base44.entities.Load, orgId, '-created_date', 100),
      listByOrg(base44.entities.Driver, orgId),
      listByOrg(base44.entities.Truck, orgId),
    ]);
    // Solo conductores y camiones del carrier activo (perfil activo).
    setDrivers(onlyActiveProfile(rawDrivers, activeProfileId, legacyIds('drivers')));
    setTrucks(onlyActiveProfile(rawTrucks, activeProfileId, legacyIds('trucks')));
    const profileIds = getProfileLoadIds();

    // Antes: "shared_with_carrier === true" mostraba la carga en TODOS los
    // perfiles, mezclando carriers. Ahora cada carga vive solo en su perfil.
    let filtered = data.filter(l => {
      if (l.profile_id) {
        return String(l.profile_id) === String(activeProfileId);
      }
      return Boolean(profileIds && profileIds.includes(l.id));
    });

    setLoads(filtered);

    // Cargas que un dispatcher me asignó por correo (vista del conductor).
    const myEmail = String(currentUser?.email || '').toLowerCase().trim();
    if (myEmail) {
      try {
        const mine = await base44.entities.Load.filter({ conductor_email: myEmail }, '-created_date', 50);
        const ownIds = new Set(filtered.map(l => l.id));
        setMyAssignedLoads((mine || []).filter(l => !ownIds.has(l.id)));
      } catch (_) {
        setMyAssignedLoads([]);
      }
    } else {
      setMyAssignedLoads([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [orgId, activeProfileId, currentUser?.email]);

  // Mis cargas + las que me asignaron por correo, en la MISMA tabla.
  const allLoads = [...loads, ...myAssignedLoads.map(l => ({ ...l, _assigned: true }))];
  const filtered = filter === 'all' ? allLoads : allLoads.filter(l => l.tipo_cliente === filter || l.estado === filter || l.resultado === filter);

  const handleSave = async (data) => {
    try {
      // Si no hay tarifa negociada, se calcula con la ofrecida (QA)
      const rpm = effectiveRpm(data);
      const dieselCost = data.millas > 0 && data.diesel_precio_dia > 0 ? (data.millas / 6.5) * data.diesel_precio_dia : 0;
      const profit = estimateProfit(data);
      const resultado = profit > 50 ? 'ganancia' : profit < -50 ? 'perdida' : 'break_even';

      const payload = {
        ...data,
        profile_id: String(editLoad?.profile_id || activeProfileId || '1'),
        revenue_por_milla: rpm,
        costo_estimado: dieselCost,
        ganancia_estimada: profit,
        resultado,
      };

      let saved;
      if (editLoad) {
        saved = await base44.entities.Load.update(editLoad.id, payload);
      } else {
        saved = await base44.entities.Load.create(withOrg(orgId, payload));
        addLoadToProfile(saved.id);
      }

      // Si se asignó un conductor NUEVO, dejar listo el borrador (no se envía solo).
      const newlyAssigned = data.conductor_id && String(data.conductor_id) !== String(editLoad?.conductor_id || '');
      if (newlyAssigned) {
        const option = driverOptionsFor(editLoad?.id).find(o => String(o.id) === String(data.conductor_id));
        if (option) {
          storeDispatchDraft({
            load: { ...(editLoad || {}), ...payload, id: saved?.id || editLoad?.id },
            option,
            carrierEmail: currentUser?.email || '',
            isEs,
          });
          toast({
            title: isEs ? `Carga asignada a ${option.name}` : `Load assigned to ${option.name}`,
            description: isEs ? 'El borrador para el Broker y el Carrier está listo.' : 'The draft for the Broker and Carrier is ready.',
            action: (
              <ToastAction altText={isEs ? 'Abrir borrador' : 'Open draft'} onClick={() => navigate('/emails?dispatch_draft=1')}>
                {isEs ? 'Abrir borrador' : 'Open draft'}
              </ToastAction>
            ),
          });
        }
      }
      window.dispatchEvent(new CustomEvent('notifications-updated'));
      setShowForm(false);
      setEditLoad(null);
      setPrefillLoad(null);
      loadData();
    } catch (err) {
      console.error('Error guardando carga:', err);
      alert('Error al guardar la carga: ' + (err?.message || 'intente de nuevo'));
    }
  };

  const driverOptionsFor = (currentLoadId) =>
    buildDriverOptions({ drivers, trucks, loads, currentLoadId, isEs });

  const handleEdit = (load) => {
    setEditLoad(load);
    setShowForm(true);
  };

  const totalRevenue = filtered.reduce((s, l) => s + effectiveRate(l), 0);
  const totalMiles = filtered.reduce((s, l) => s + (l.millas || 0), 0);
  const avgRate = totalMiles > 0 ? totalRevenue / totalMiles : 0;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">{t.loadsPage.title}</h1>
          <p className="text-sm text-muted-foreground">{allLoads.length} {t.loadsPage.registered}</p>
        </div>
        <button
          onClick={() => {
            if (limits?.LOADS && loads.length >= limits.LOADS) {
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
        currentCount={loads.length}
        maxLimit={limits?.LOADS || 5}
      />

      {/* Summary strip */}
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
          load={editLoad || prefillLoad}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditLoad(null); setPrefillLoad(null); }}
          driverOptions={driverOptionsFor(editLoad?.id)}
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
                      {load.conductor_nombre && (
                        <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-violet-300">
                          <UserCheck className="w-3 h-3" />
                          {load.conductor_nombre}{load.truck_placa ? ` · ${load.truck_placa}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden sm:table-cell">{load.broker_nombre || '--'}</td>
                    <td className="px-4 py-3 hidden md:table-cell"><StatusBadge status={load.tipo_cliente || 'broker_directo'} /></td>
                    <td className="px-4 py-3 text-right text-xs font-mono text-muted-foreground hidden md:table-cell">{load.millas || '--'}</td>
                    <td className={`px-4 py-3 text-right text-xs font-mono font-semibold ${
                      effectiveRpm(load) >= 3 ? 'text-green-400' :
                      effectiveRpm(load) >= 2.6 ? 'text-yellow-400' : 'text-red-400'
                    }`}>{effectiveRpm(load) > 0 ? `$${effectiveRpm(load).toFixed(2)}` : '--'}</td>
                    <td className="px-4 py-3 text-right text-xs font-mono text-foreground">${effectiveRate(load).toLocaleString('en-US')}</td>
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
