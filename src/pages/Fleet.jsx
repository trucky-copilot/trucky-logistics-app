import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Truck, Plus, X, Pencil, Trash2, Loader2, Sparkles, CheckCircle2, Mail, Package, UserCheck } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import DeleteConfirmModal from '@/components/DeleteConfirmModal';
import { useOrganizationId, useAppState } from '@/lib/AppStateContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useProfile } from '@/lib/ProfileContext';
import { listByOrg, withOrg } from '@/lib/orgScope';
import { useDemo } from '@/lib/DemoContext';
import DemoLimitModal from '@/components/DemoLimitModal';
import { useToast } from '@/components/ui/use-toast';
import {
  AUTOMATION_PENDING_DISPATCH_LOAD_KEY,
  AUTOMATION_FLEET_TO_EMAIL_DRAFT_KEY,
} from '@/lib/dispatchAutomation';

const ESTADOS = ['disponible', 'en_ruta', 'en_yarda', 'mantenimiento'];
const EQUIPMENT_TYPES = [
  { value: 'dry_van', label: 'Dry Van' },
  { value: 'reefer', label: 'Reefer' },
  { value: 'flatbed', label: 'Flatbed' },
  { value: 'step_deck', label: 'Step Deck' },
  { value: 'power_only', label: 'Power Only' },
  { value: 'drayage', label: 'Drayage' },
];
function TruckForm({ truck, onSave, onClose }) {
  const { t } = useLanguage();
  const { setUnsavedChanges } = useProfile();
  const initialState = {
    placa: '', modelo: '', año: '', estado: 'disponible',
    equipment_type: 'dry_van',
    conductor_nombre: '', chasis_disponible: true, chasis_numero: '', notas: '',
    ...truck
  };
  const [form, setForm] = useState(initialState);
  const [isSaving, setIsSaving] = useState(false);
  
  useEffect(() => {
    const isUnsaved = JSON.stringify(form) !== JSON.stringify(initialState);
    setUnsavedChanges('FleetForm', isUnsaved);
    return () => setUnsavedChanges('FleetForm', false);
  }, [form, truck, setUnsavedChanges]);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const handleSubmit = async (e) => { 
    e.preventDefault(); 
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onSave(form);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">{truck ? t.fleet.edit : t.fleet.new}</h2>
          <button onClick={onClose} disabled={isSaving} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.fleet.plate} *</label>
              <input required value={form.placa} onChange={e => set('placa', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" placeholder="ABC-1234" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.fleet.model}</label>
              <input value={form.modelo} onChange={e => set('modelo', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" placeholder="Freightliner" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.fleet.year}</label>
              <input type="number" value={form.año} onChange={e => set('año', Number(e.target.value))}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.fleet.status}</label>
              <select value={form.estado} onChange={e => set('estado', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50">
                {ESTADOS.map(s => <option key={s} value={s}>{t.statuses?.[s] || s.replace('_', ' ')}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {t.fleet.equipmentType || 'Tipo de equipo'}
            </label>

            <select
              value={form.equipment_type}
              onChange={e => set('equipment_type', e.target.value)}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              {EQUIPMENT_TYPES.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t.fleet.assignedDriver}</label>
            <input value={form.conductor_nombre} onChange={e => set('conductor_nombre', e.target.value)}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.fleet.chassis}</label>
              <input value={form.chasis_numero} onChange={e => set('chasis_numero', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.chasis_disponible} onChange={e => set('chasis_disponible', e.target.checked)} className="rounded" />
                <span className="text-xs text-muted-foreground">{t.fleet.chassisAvailable}</span>
              </label>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t.fleet.notes}</label>
            <textarea value={form.notas} onChange={e => set('notas', e.target.value)} rows={2}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={isSaving} className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground disabled:opacity-40">{t.fleet.cancel}</button>
            <button type="submit" disabled={isSaving} className="flex-1 py-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50 flex items-center justify-center gap-2">
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t.fleet.save}...</span>
                </>
              ) : (
                t.fleet.save
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Fleet() {
  const { t, locale } = useLanguage();
  const orgId = useOrganizationId();
  const { currentUser } = useAppState();
  const { activeProfileId, profiles } = useProfile();
  const { isDemoUser, limits } = useDemo();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [trucks, setTrucks] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [pendingLoads, setPendingLoads] = useState([]);
  const [selectedLoadId, setSelectedLoadId] = useState('');
  const [pendingDispatchCtx, setPendingDispatchCtx] = useState(null);
  const [assigningTruckId, setAssigningTruckId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [editTruck, setEditTruck] = useState(null);
  const [deleteTruck, setDeleteTruck] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const isEs = locale !== 'en';

  const getProfileTruckIds = () => {
    const key = `profile_trucks_${orgId}_${activeProfileId}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  };

  const addTruckToProfile = (truckId) => {
    const key = `profile_trucks_${orgId}_${activeProfileId}`;
    const current = getProfileTruckIds() || [];
    localStorage.setItem(key, JSON.stringify([...current, truckId]));
  };

  const handleDeleteTruck = async () => {
    if (!deleteTruck) return;
    try {
      setDeleteLoading(true);
      await base44.entities.Truck.delete(deleteTruck.id);
      const key = `profile_trucks_${orgId}_${activeProfileId}`;
      const current = getProfileTruckIds() || [];
      localStorage.setItem(key, JSON.stringify(current.filter(id => id !== deleteTruck.id)));
      setDeleteTruck(null);
      loadData();
    } catch (err) {
      console.error('Error eliminando camión:', err);
      alert('Error al eliminar: ' + (err?.message || 'intente de nuevo'));
    } finally {
      setDeleteLoading(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    const [data, allDrivers, allLoads] = await Promise.all([
      listByOrg(base44.entities.Truck, orgId),
      listByOrg(base44.entities.Driver, orgId),
      listByOrg(base44.entities.Load, orgId, '-created_date', 50),
    ]);
    const profileIds = getProfileTruckIds();
    
    let filtered = data.filter(t => {
      if (t.profile_id) {
        return t.profile_id === activeProfileId;
      }
      return Boolean(profileIds && profileIds.includes(t.id));
    });
    
    setTrucks(filtered);
    setDrivers(allDrivers || []);

    // Cargar cargas pendientes de asignar o recién creadas por la automatización
    const rawPending = sessionStorage.getItem(AUTOMATION_PENDING_DISPATCH_LOAD_KEY);
    let parsedPending = null;
    if (rawPending) {
      try {
        parsedPending = JSON.parse(rawPending);
        setPendingDispatchCtx(parsedPending);
      } catch (_) {}
    }

    const unassignedLoads = (allLoads || []).filter(
      l => l.estado === 'pendiente' || (parsedPending?.loadId && l.id === parsedPending.loadId)
    );
    setPendingLoads(unassignedLoads);
    if (parsedPending?.loadId) {
      setSelectedLoadId(parsedPending.loadId);
    } else if (unassignedLoads.length > 0 && !selectedLoadId) {
      setSelectedLoadId(unassignedLoads[0].id);
    }

    setLoading(false);
  };
  useEffect(() => { loadData(); }, [orgId, activeProfileId]);

  const activeTargetLoad =
    pendingLoads.find(l => l.id === selectedLoadId) ||
    pendingDispatchCtx?.load ||
    pendingLoads[0] ||
    null;

  // ─── Elegir conductor disponible -> Actualizar Carga (visible en Carrier) -> Abrir borrador en Emails ───
  const handleAssignAvailableDriver = async (truck) => {
    const loadToAssign = activeTargetLoad;
    if (!loadToAssign) {
      toast({
        title: isEs ? 'Selecciona una carga' : 'Select a load',
        description: isEs ? 'Primero crea o selecciona una carga pendiente para asignar.' : 'First create or select a pending load.',
        variant: 'destructive',
      });
      return;
    }

    setAssigningTruckId(truck.id);
    try {
      const driverName = truck.conductor_nombre || 'Conductor Asignado';
      const matchingDriver = drivers.find(
        d =>
          (d.truck_asignado && d.truck_asignado.toLowerCase() === String(truck.placa || '').toLowerCase()) ||
          (d.nombre && driverName.toLowerCase().includes(d.nombre.toLowerCase()))
      );
      const driverPhone = matchingDriver?.telefono || '';

      // 1. Actualizar la carga en Base44 para que tenga el conductor, camión, estado y sea visible en el rol de Carrier
      const updatedLoad = await base44.entities.Load.update(loadToAssign.id, {
        conductor_nombre: driverName,
        truck_placa: truck.placa,
        estado: 'en_transito',
        shared_with_carrier: true,
      });

      // 2. Asegurar que todos los perfiles de la cuenta (incluido el perfil Carrier) tengan el ID de la carga en localStorage
      const allProfileIds = Array.from(
        new Set(['1', '2', '3', '4', '5', ...(profiles || []).map(p => String(p.id))])
      );
      for (const pid of allProfileIds) {
        const key = `profile_loads_${orgId}_${pid}`;
        try {
          const existing = JSON.parse(localStorage.getItem(key) || '[]');
          if (Array.isArray(existing) && !existing.includes(loadToAssign.id)) {
            localStorage.setItem(key, JSON.stringify([...existing, loadToAssign.id]));
          }
        } catch (_) {}
      }

      // 3. Actualizar el camión a "en_ruta"
      await base44.entities.Truck.update(truck.id, {
        estado: 'en_ruta',
      });

      // 4. Construir el borrador de correo para el Broker y el Carrier
      const brokerEmail =
        loadToAssign.broker_email ||
        pendingDispatchCtx?.brokerEmail ||
        '';
      const carrierEmail =
        loadToAssign.carrier_email ||
        currentUser?.email ||
        '';

      const refLabel = loadToAssign.numero_referencia ? ` (Ref: ${loadToAssign.numero_referencia})` : '';
      const draftSubject = pendingDispatchCtx?.emailSubject
        ? (/^re:/i.test(pendingDispatchCtx.emailSubject)
            ? pendingDispatchCtx.emailSubject
            : `Re: ${pendingDispatchCtx.emailSubject}`)
        : `Confirmación de Despacho y Unidad Asignada: ${loadToAssign.origen} → ${loadToAssign.destino}${refLabel}`;

      const draftBody = isEs
        ? `Hola equipo (${loadToAssign.broker_nombre || 'Broker'} & Carrier),\n\nConfirmamos la asignación de conductor y unidad para la siguiente carga verificada:\n\n` +
          `• Ruta: ${loadToAssign.origen} → ${loadToAssign.destino} (${loadToAssign.millas || '--'} millas)\n` +
          `• Fecha de Recogida (Pickup): ${loadToAssign.fecha_carga || 'Confirmada'}\n` +
          `• Fecha de Entrega (Delivery): ${loadToAssign.fecha_entrega || 'Confirmada'}\n` +
          `• Citas / Ventana Horaria: ${loadToAssign.citas || 'Según Rate Confirmation'}\n` +
          (loadToAssign.numero_referencia ? `• Load # / Referencia: ${loadToAssign.numero_referencia}\n` : '') +
          `• Tarifa Acordada: $${(loadToAssign.tarifa_negociada || 0).toLocaleString()}\n\n` +
          `🚛 DATOS DE LA UNIDAD Y CONDUCTOR ASIGNADO:\n` +
          `• Conductor: ${driverName}${driverPhone ? ' (Tel: ' + driverPhone + ')' : ''}\n` +
          `• Camión / Placa: ${truck.placa} (${truck.modelo || 'Tractor'})\n` +
          `• Equipo: ${(truck.equipment_type || 'dry_van').replace('_', ' ').toUpperCase()}\n\n` +
          `La carga ya se encuentra activa y visible en el panel de Cargas del Carrier.\n\nSaludos cordiales,\nDepartamento de Despacho — Trucky`
        : `Hello team (${loadToAssign.broker_nombre || 'Broker'} & Carrier),\n\nWe confirm the driver and truck assignment for the following verified load:\n\n` +
          `• Route: ${loadToAssign.origen} → ${loadToAssign.destino} (${loadToAssign.millas || '--'} miles)\n` +
          `• Pickup Date: ${loadToAssign.fecha_carga || 'Confirmed'}\n` +
          `• Delivery Date: ${loadToAssign.fecha_entrega || 'Confirmed'}\n` +
          `• Appointments / Window: ${loadToAssign.citas || 'Per Rate Confirmation'}\n` +
          (loadToAssign.numero_referencia ? `• Load # / Reference: ${loadToAssign.numero_referencia}\n` : '') +
          `• Agreed Rate: $${(loadToAssign.tarifa_negociada || 0).toLocaleString()}\n\n` +
          `🚛 ASSIGNED DRIVER & TRUCK DETAILS:\n` +
          `• Driver: ${driverName}${driverPhone ? ' (Phone: ' + driverPhone + ')' : ''}\n` +
          `• Truck / Plate: ${truck.placa} (${truck.modelo || 'Tractor'})\n` +
          `• Equipment: ${(truck.equipment_type || 'dry_van').replace('_', ' ').toUpperCase()}\n\n` +
          `The load is now active and visible in the Carrier Loads section.\n\nBest regards,\nDispatch Department — Trucky`;

      const emailDraftPayload = {
        loadId: updatedLoad?.id || loadToAssign.id,
        origen: loadToAssign.origen,
        destino: loadToAssign.destino,
        brokerEmail,
        carrierEmail,
        conductorNombre: driverName,
        truckPlaca: truck.placa,
        subject: draftSubject,
        content: draftBody,
        threadId: loadToAssign.thread_id || pendingDispatchCtx?.threadId || null,
        inReplyTo: pendingDispatchCtx?.rfcMessageId || null,
        references: pendingDispatchCtx?.rfcMessageId || null,
        threadMessages: pendingDispatchCtx?.threadMessages || null,
      };

      sessionStorage.setItem(AUTOMATION_FLEET_TO_EMAIL_DRAFT_KEY, JSON.stringify(emailDraftPayload));
      sessionStorage.removeItem(AUTOMATION_PENDING_DISPATCH_LOAD_KEY);

      toast({
        title: isEs ? 'Conductor asignado y carga compartida con Carrier' : 'Driver assigned & load shared with Carrier',
        description: isEs
          ? `${driverName} (${truck.placa}) asignado. Abriendo borrador de correo para Broker y Carrier...`
          : `${driverName} (${truck.placa}) assigned. Opening email draft for Broker and Carrier...`,
      });

      navigate('/emails?dispatch_draft=1');
    } catch (err) {
      console.error('Error asignando conductor a la carga:', err);
      toast({
        title: isEs ? 'Error al asignar conductor' : 'Failed to assign driver',
        description: err?.message || 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setAssigningTruckId(null);
    }
  };

  const handleSave = async (data) => {
    try {
      const cleanData = { ...data, profile_id: activeProfileId };
      if (editTruck) {
        await base44.entities.Truck.update(editTruck.id, cleanData);
      } else {
        const created = await base44.entities.Truck.create(withOrg(orgId, cleanData));
        addTruckToProfile(created.id);
      }

      window.dispatchEvent(new CustomEvent('notifications-updated'));

      setShowForm(false); setEditTruck(null); loadData();
    } catch (err) {
      console.error('Error guardando camión:', err);
      alert('Error al guardar: ' + (err?.message || 'intente de nuevo'));
    }
  };

  const statusCount = (s) => trucks.filter(t => t.estado === s).length;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">{t.fleet.title}</h1>
          <p className="text-sm text-muted-foreground">{trucks.length} {t.fleet.trucks}</p>
        </div>
        <button onClick={() => {
          if (limits?.FLEET && trucks.length >= limits.FLEET) {
            setShowLimitModal(true);
            return;
          }
          setEditTruck(null); 
          setShowForm(true); 
        }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground">
          <Plus className="w-3.5 h-3.5" />{t.fleet.add}
        </button>
      </div>

      {/* Panel de Asignación de Conductor Disponible para la Carga Creada */}
      {(activeTargetLoad || pendingLoads.length > 0) && (
        <div className="rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-transparent p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 flex-shrink-0 mt-0.5">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-amber-300 uppercase tracking-wide">
                  {isEs
                    ? 'Despacho Automático: Elige un Conductor Disponible'
                    : 'Automated Dispatch: Choose an Available Driver'}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isEs
                    ? 'Al elegir un conductor disponible, la carga quedará visible en la sección de Cargas del rol Carrier y se abrirá el borrador de correo para el Broker y el Carrier.'
                    : 'Choosing an available driver makes the load visible in the Carrier Loads section and opens the email draft for Broker and Carrier.'}
                </p>
              </div>
            </div>

            {pendingLoads.length > 1 && (
              <div className="min-w-[230px]">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase block mb-1">
                  {isEs ? 'Carga a despachar:' : 'Load to dispatch:'}
                </label>
                <select
                  value={selectedLoadId}
                  onChange={(e) => setSelectedLoadId(e.target.value)}
                  className="w-full bg-card border border-border rounded-xl px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {pendingLoads.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.origen} → {pl.destino} (${(pl.tarifa_negociada || 0).toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {activeTargetLoad && (
            <div className="rounded-xl bg-card/80 border border-border/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-primary" />
                <span className="font-bold text-foreground">
                  {activeTargetLoad.origen} → {activeTargetLoad.destino}
                </span>
                <span className="text-muted-foreground">
                  · {activeTargetLoad.millas || '--'} mi · ${(activeTargetLoad.tarifa_negociada || 0).toLocaleString()}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Broker: <span className="text-foreground font-medium">{activeTargetLoad.broker_nombre || 'Broker'}</span>
                {activeTargetLoad.fecha_carga && ` · Pickup: ${activeTargetLoad.fecha_carga}`}
              </div>
            </div>
          )}
        </div>
      )}

      <DemoLimitModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        entityName="camiones"
        currentCount={trucks.length}
        maxLimit={limits?.FLEET || 5}
      />

      {/* Status summary */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { key: 'disponible', label: t.fleet.available, color: 'text-green-400' },
          { key: 'en_ruta', label: t.fleet.enRoute, color: 'text-violet-400' },
          { key: 'en_yarda', label: t.fleet.yard, color: 'text-yellow-400' },
          { key: 'mantenimiento', label: t.fleet.maintenance, color: 'text-red-400' },
        ].map(s => (
          <div key={s.key} className="bg-card border border-border rounded-xl p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{statusCount(s.key)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {showForm && <TruckForm truck={editTruck} onSave={handleSave} onClose={() => { setShowForm(false); setEditTruck(null); }} />}

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : trucks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Truck className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">{t.fleet.noTrucks}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {trucks.map(truck => {
            const isAvailable = truck.estado === 'disponible';
            const isAssigningThis = assigningTruckId === truck.id;

            return (
              <div
                key={truck.id}
                className={`bg-card border rounded-xl p-4 transition-all ${
                  isAvailable && activeTargetLoad
                    ? 'border-emerald-500/40 hover:border-emerald-400 shadow-md'
                    : 'border-border hover:border-primary/30'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Truck className="w-4 h-4 text-primary" />
                      <span className="font-bold text-foreground font-mono">{truck.placa}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{truck.modelo} {truck.año || ''}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={truck.estado} />
                    <button onClick={() => { setEditTruck(truck); setShowForm(true); }}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                      title={locale === 'en' ? 'Edit' : 'Editar'}>
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={() => setDeleteTruck(truck)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                      title={locale === 'en' ? 'Delete' : 'Eliminar'}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>{t.fleet.assignedDriver}:</span>
                    <span className="text-foreground font-semibold">{truck.conductor_nombre || t.fleet.noAssigned}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t.fleet.chassis}:</span>
                    <span className={truck.chasis_disponible ? 'text-green-400' : 'text-red-400'}>
                      {truck.chasis_disponible ? t.fleet.availableText : t.fleet.unavailable}
                      {truck.chasis_numero ? ` (${truck.chasis_numero})` : ''}
                    </span>
                  </div>
                  {truck.notas && <div className="text-muted-foreground/70 italic truncate">{truck.notas}</div>}
                </div>

                {/* Botón de Automatización para elegir al conductor disponible y generar el borrador a Broker y Carrier */}
                {isAvailable && activeTargetLoad && (
                  <div className="mt-3.5 pt-3 border-t border-border/60">
                    <button
                      type="button"
                      onClick={() => handleAssignAvailableDriver(truck)}
                      disabled={Boolean(assigningTruckId)}
                      className="w-full py-2 px-3 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-zinc-950 shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isAssigningThis ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-950" />
                          <span>{isEs ? 'Asignando y creando borrador...' : 'Assigning & creating draft...'}</span>
                        </>
                      ) : (
                        <>
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>
                            {isEs
                              ? `Elegir Conductor (${truck.conductor_nombre || truck.placa}) y Enviar Borrador`
                              : `Choose Driver (${truck.conductor_nombre || truck.placa}) & Open Draft`}
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <DeleteConfirmModal
        isOpen={!!deleteTruck}
        title={locale === 'en' ? 'Do you want to delete this Truck?' : '¿Desea eliminar el Camión?'}
        subtitle={deleteTruck ? `${deleteTruck.placa} ${deleteTruck.modelo || ''}` : ''}
        onConfirm={handleDeleteTruck}
        onClose={() => setDeleteTruck(null)}
        loading={deleteLoading}
        confirmText={locale === 'en' ? 'Delete' : 'Eliminar'}
        cancelText={locale === 'en' ? 'Cancel' : 'Cancelar'}
      />
    </div>
  );
}
