import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Plus, Package, Trash2, Pencil, Truck, Sparkles, Clock, FileText, ArrowRight } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import LoadForm from '@/components/LoadForm';
import DeleteConfirmModal from '@/components/DeleteConfirmModal';
import { useOrganizationId } from '@/lib/AppStateContext';
import { useLanguage } from '@/lib/LanguageContext';
import { listByOrg, withOrg } from '@/lib/orgScope';
import { useProfile } from '@/lib/ProfileContext';
import { useDemo } from '@/lib/DemoContext';
import DemoLimitModal from '@/components/DemoLimitModal';
import { useToast } from '@/components/ui/use-toast';
import {
  AUTOMATION_CHECKER_TO_LOAD_KEY,
  AUTOMATION_PENDING_DISPATCH_LOAD_KEY,
} from '@/lib/dispatchAutomation';

export default function Loads() {
  const orgId = useOrganizationId();
  const { t, locale } = useLanguage();
  const { activeProfileId } = useProfile();
  const { isDemoUser, limits } = useDemo();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [editLoad, setEditLoad] = useState(null);
  const [deleteLoad, setDeleteLoad] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [automatedLoadId, setAutomatedLoadId] = useState(null);
  const autoCreateHandledRef = useRef(false);

  const isEs = locale !== 'en';

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

    // Prioridad 1 (Backend): si los registros tienen profile_id guardado en Base44, filtrar por él,
    // PERO si la carga fue asignada a un conductor (shared_with_carrier === true o tiene conductor_nombre),
    // también es visible en el perfil/rol de Carrier dentro de la misma organización.
    let filtered = data.filter(l => {
      if (l.shared_with_carrier === true || (l.conductor_nombre && String(l.conductor_nombre).trim() !== '')) {
        return true;
      }
      if (l.profile_id) {
        return String(l.profile_id) === String(activeProfileId);
      }
      return Boolean(profileIds && profileIds.includes(l.id));
    });

    setLoads(filtered);
    setLoading(false);
    return filtered;
  };

  useEffect(() => {
    loadData();
  }, [orgId, activeProfileId]);

  // ─── Automatización desde el Verificador de Documentos: Crear la carga con los datos llenos y el hilo resumido ───
  useEffect(() => {
    if (!orgId || !activeProfileId || autoCreateHandledRef.current) return;
    const rawAutoLoad = sessionStorage.getItem(AUTOMATION_CHECKER_TO_LOAD_KEY);
    if (!rawAutoLoad) return;

    autoCreateHandledRef.current = true;
    sessionStorage.removeItem(AUTOMATION_CHECKER_TO_LOAD_KEY);

    (async () => {
      try {
        const autoData = JSON.parse(rawAutoLoad);
        const millas = Number(autoData.millas) || 250;
        const tarifa = Number(autoData.tarifa_negociada) || 850;
        const dieselPrecio = 5.40;
        const rpm = millas > 0 && tarifa > 0 ? tarifa / millas : 0;
        const dieselCost = millas > 0 ? (millas / 6.5) * dieselPrecio : 0;
        const profit = tarifa - dieselCost - tarifa * 0.25;
        const resultado = profit > 50 ? 'ganancia' : profit < -50 ? 'perdida' : 'break_even';

        const createPayload = {
          origen: autoData.origen || 'Miami, FL',
          destino: autoData.destino || 'Tampa, FL',
          millas,
          broker_nombre: autoData.broker_nombre || 'Broker',
          broker_email: autoData.broker_email || '',
          tipo_cliente: 'broker_directo',
          tarifa_ofrecida: Number(autoData.tarifa_ofrecida) || tarifa,
          tarifa_negociada: tarifa,
          diesel_precio_dia: dieselPrecio,
          fecha_carga: autoData.fecha_carga || new Date().toISOString().slice(0, 10),
          fecha_entrega: autoData.fecha_entrega || new Date().toISOString().slice(0, 10),
          citas: autoData.citas || '',
          numero_referencia: autoData.numero_referencia || '',
          notas: autoData.notas || '',
          thread_id: autoData.thread_id || null,
          estado: 'pendiente',
          profile_id: activeProfileId,
          revenue_por_milla: rpm,
          costo_estimado: dieselCost,
          ganancia_estimada: profit,
          resultado,
        };

        const created = await base44.entities.Load.create(withOrg(orgId, createPayload));
        addLoadToProfile(created.id);
        setAutomatedLoadId(created.id);

        // Guardar en sessionStorage la carga pendiente de asignar conductor en Flota
        const pendingDispatch = {
          loadId: created.id,
          load: created,
          brokerEmail: autoData.broker_email || '',
          brokerName: createPayload.broker_nombre,
          threadId: autoData.thread_id || null,
          rfcMessageId: autoData.rfc_message_id || null,
          threadMessages: autoData.threadMessages || [],
          emailSubject: autoData.emailSubject || '',
        };
        sessionStorage.setItem(AUTOMATION_PENDING_DISPATCH_LOAD_KEY, JSON.stringify(pendingDispatch));

        await loadData();
        // Abrir el formulario con todos los datos llenos y el resumen del hilo para que el Dispatcher los vea de inmediato
        setEditLoad(created);
        setShowForm(true);

        toast({
          title: isEs ? 'Carga creada en Mis Cargas' : 'Load created in My Loads',
          description: isEs
            ? `${created.origen} → ${created.destino} registrada con el hilo resumido. Ahora puedes elegir el conductor disponible en Flota.`
            : `${created.origen} → ${created.destino} registered with thread summary. You can now assign an available driver in Fleet.`,
        });
      } catch (err) {
        console.error('[Loads] Error creando carga desde automatización:', err);
      }
    })();
  }, [orgId, activeProfileId]);

  const handleGoToFleetAssignDriver = (loadItem) => {
    const existingPendingRaw = sessionStorage.getItem(AUTOMATION_PENDING_DISPATCH_LOAD_KEY);
    let existingPending = {};
    try {
      existingPending = existingPendingRaw ? JSON.parse(existingPendingRaw) : {};
    } catch (_) {}

    const pendingDispatch = {
      ...existingPending,
      loadId: loadItem.id,
      load: loadItem,
      brokerEmail: loadItem.broker_email || existingPending.brokerEmail || '',
      brokerName: loadItem.broker_nombre || existingPending.brokerName || 'Broker',
      threadId: loadItem.thread_id || existingPending.threadId || null,
    };
    sessionStorage.setItem(AUTOMATION_PENDING_DISPATCH_LOAD_KEY, JSON.stringify(pendingDispatch));
    navigate('/flota?assign_load=' + encodeURIComponent(loadItem.id));
  };

  const filtered = filter === 'all' ? loads : loads.filter(l => l.tipo_cliente === filter || l.estado === filter || l.resultado === filter);

  const handleSave = async (data) => {
    try {
      const rpm = data.millas > 0 && data.tarifa_negociada > 0 ? data.tarifa_negociada / data.millas : 0;
      const dieselCost = data.millas > 0 && data.diesel_precio_dia > 0 ? (data.millas / 6.5) * data.diesel_precio_dia : 0;
      const profit = data.tarifa_negociada - dieselCost - (data.tarifa_negociada * 0.25);
      const resultado = profit > 50 ? 'ganancia' : profit < -50 ? 'perdida' : 'break_even';

      const payload = { 
        ...data, 
        profile_id: editLoad?.profile_id || activeProfileId, 
        revenue_por_milla: rpm, 
        costo_estimado: dieselCost, 
        ganancia_estimada: profit, 
        resultado,
        shared_with_carrier: Boolean(data.shared_with_carrier || (data.conductor_nombre && String(data.conductor_nombre).trim() !== '')),
      };

      let savedRecord = null;
      if (editLoad?.id) {
        savedRecord = await base44.entities.Load.update(editLoad.id, payload);
      } else {
        savedRecord = await base44.entities.Load.create(withOrg(orgId, payload));
        addLoadToProfile(savedRecord.id);
      }

      // Actualizar también el contexto de despacho pendiente si corresponde a esta carga
      const rawPending = sessionStorage.getItem(AUTOMATION_PENDING_DISPATCH_LOAD_KEY);
      if (rawPending && savedRecord) {
        try {
          const parsedPending = JSON.parse(rawPending);
          if (!parsedPending.loadId || parsedPending.loadId === savedRecord.id) {
            parsedPending.loadId = savedRecord.id;
            parsedPending.load = savedRecord;
            sessionStorage.setItem(AUTOMATION_PENDING_DISPATCH_LOAD_KEY, JSON.stringify(parsedPending));
          }
        } catch (_) {}
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

  const targetAutomatedLoad = loads.find(l => l.id === automatedLoadId) || loads.find(l => !l.conductor_nombre);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">{t.loadsPage.title}</h1>
          <p className="text-sm text-muted-foreground">{loads.length} {t.loadsPage.registered}</p>
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

      {/* Banner de Automatización para ir a Flota a elegir conductor disponible */}
      {targetAutomatedLoad && (
        <div className="rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-transparent p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 flex-shrink-0 mt-0.5">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-amber-300 uppercase tracking-wide">
                {isEs ? 'Siguiente Paso de Automatización: Asignar Conductor en Flota' : 'Next Automation Step: Assign Driver in Fleet'}
              </p>
              <p className="text-xs text-foreground mt-0.5">
                {isEs
                  ? `Carga lista: ${targetAutomatedLoad.origen} → ${targetAutomatedLoad.destino} ($${(targetAutomatedLoad.tarifa_negociada || 0).toLocaleString()}). Elige al conductor disponible en Flota para compartirla con el Carrier y generar el borrador de correo.`
                  : `Load ready: ${targetAutomatedLoad.origen} → ${targetAutomatedLoad.destino}. Choose an available driver in Fleet to share with Carrier and generate the email draft.`}
              </p>
            </div>
          </div>

          <button
            onClick={() => handleGoToFleetAssignDriver(targetAutomatedLoad)}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-zinc-950 shadow-md transition-all whitespace-nowrap flex-shrink-0 cursor-pointer"
          >
            <Truck className="w-3.5 h-3.5" />
            <span>{isEs ? 'Elegir Conductor en Flota →' : 'Choose Driver in Fleet →'}</span>
          </button>
        </div>
      )}

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
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">{isEs ? 'Fechas / Citas' : 'Dates / Appts'}</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">{isEs ? 'Conductor / Unidad' : 'Driver / Truck'}</th>
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
                      {load.notas && (
                        <div className="text-[11px] text-primary/90 line-clamp-1 mt-0.5 max-w-[240px]" title={load.notas}>
                          {load.notas.replace(/\n/g, ' · ')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden sm:table-cell">
                      <div>{load.broker_nombre || '--'}</div>
                      {load.numero_referencia && (
                        <div className="text-[10px] font-mono text-zinc-400">Ref: {load.numero_referencia}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                      <div>{load.fecha_carga || '--'} → {load.fecha_entrega || '--'}</div>
                      {load.citas && (
                        <div className="text-[10px] text-amber-300 flex items-center gap-1 mt-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{load.citas}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs hidden md:table-cell" onClick={e => e.stopPropagation()}>
                      {load.conductor_nombre ? (
                        <div>
                          <span className="font-semibold text-emerald-400">{load.conductor_nombre}</span>
                          {load.truck_placa && (
                            <span className="block text-[10px] font-mono text-muted-foreground">{load.truck_placa}</span>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleGoToFleetAssignDriver(load)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition-colors"
                        >
                          <Truck className="w-3 h-3" />
                          <span>{isEs ? 'Asignar en Flota' : 'Assign in Fleet'}</span>
                        </button>
                      )}
                    </td>
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
