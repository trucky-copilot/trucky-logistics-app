import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Truck, Plus, X, Pencil, Trash2, Loader2, UserCheck, ChevronDown } from 'lucide-react';
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
  const { limits } = useDemo();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [trucks, setTrucks] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [profileLoads, setProfileLoads] = useState([]);
  const [driverMenuOpen, setDriverMenuOpen] = useState(false);
  const [assigningDriver, setAssigningDriver] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [editTruck, setEditTruck] = useState(null);
  const [deleteTruck, setDeleteTruck] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const isEs = locale !== 'en';

  const getProfileIds = (entity) => {
    const key = `profile_${entity}_${orgId}_${activeProfileId}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  };

  // Filtrado estricto por profile_id en Base44
  const filterByActiveProfile = (items, entity) => {
    const profileIds = getProfileIds(entity);
    return (items || []).filter(item => {
      if (item.profile_id) {
        return String(item.profile_id) === String(activeProfileId);
      }
      return Boolean(profileIds && profileIds.includes(item.id));
    });
  };

  const addTruckToProfile = (truckId) => {
    const key = `profile_trucks_${orgId}_${activeProfileId}`;
    const current = getProfileIds('trucks') || [];
    if (!current.includes(truckId)) {
      localStorage.setItem(key, JSON.stringify([...current, truckId]));
    }
  };

  const handleDeleteTruck = async () => {
    if (!deleteTruck) return;
    try {
      setDeleteLoading(true);
      await base44.entities.Truck.delete(deleteTruck.id);
      const key = `profile_trucks_${orgId}_${activeProfileId}`;
      const current = getProfileIds('trucks') || [];
      localStorage.setItem(key, JSON.stringify(current.filter(id => id !== deleteTruck.id)));
      setDeleteTruck(null);
      window.dispatchEvent(new CustomEvent('notifications-updated'));
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
    const [rawTrucks, rawDrivers, rawLoads] = await Promise.all([
      listByOrg(base44.entities.Truck, orgId),
      listByOrg(base44.entities.Driver, orgId),
      listByOrg(base44.entities.Load, orgId, '-created_date', 100),
    ]);

    setTrucks(filterByActiveProfile(rawTrucks, 'trucks'));
    setDrivers(filterByActiveProfile(rawDrivers, 'drivers'));
    setProfileLoads(filterByActiveProfile(rawLoads, 'loads'));
    setLoading(false);
  };

  useEffect(() => {
    setDriverMenuOpen(false);
    loadData();
  }, [orgId, activeProfileId]);

  // Construir lista de conductores disponibles únicamente de ESTE perfil (activeProfileId)
  const availableDriverOptions = (() => {
    const options = [];
    const seen = new Set();

    drivers
      .filter(d => !d.estado || d.estado === 'activo')
      .forEach(d => {
        const name = `${d.nombre || ''} ${d.apellido || ''}`.trim();
        if (!name) return;
        const matchedTruck =
          trucks.find(
            tr =>
              (d.truck_asignado && String(d.truck_asignado).toLowerCase() === String(tr.placa || '').toLowerCase()) ||
              (tr.conductor_nombre && String(tr.conductor_nombre).toLowerCase() === name.toLowerCase())
          ) || trucks.find(tr => tr.estado === 'disponible');

        const key = name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          options.push({
            id: d.id,
            driverName: name,
            driverPhone: d.telefono || '',
            truck: matchedTruck || null,
            placa: matchedTruck?.placa || d.truck_asignado || '',
          });
        }
      });

    trucks
      .filter(tr => tr.estado === 'disponible' && tr.conductor_nombre)
      .forEach(tr => {
        const name = String(tr.conductor_nombre).trim();
        const key = name.toLowerCase();
        if (name && !seen.has(key)) {
          seen.add(key);
          options.push({
            id: `truck-${tr.id}`,
            driverName: name,
            driverPhone: '',
            truck: tr,
            placa: tr.placa || '',
          });
        }
      });

    return options;
  })();

  const handleSelectAvailableDriver = async (option) => {
    setDriverMenuOpen(false);
    const loadToAssign =
      profileLoads.find(l => l.estado === 'pendiente' && !l.conductor_nombre) ||
      profileLoads.find(l => l.estado === 'pendiente') ||
      profileLoads[0] ||
      null;

    if (!loadToAssign) {
      toast({
        title: isEs ? 'No hay cargas pendientes en este perfil' : 'No pending loads in this profile',
        description: isEs ? 'Primero crea una carga para asignarle el conductor.' : 'First create a load to assign the driver.',
        variant: 'destructive',
      });
      return;
    }

    setAssigningDriver(true);
    try {
      const driverName = option.driverName;
      const placa = option.placa || '';

      // 1. Actualizar la carga en Base44 y marcar shared_with_carrier: true para que sea visible en el rol Carrier
      const updatedLoad = await base44.entities.Load.update(loadToAssign.id, {
        conductor_nombre: driverName,
        truck_placa: placa,
        estado: 'en_transito',
        shared_with_carrier: true,
      });

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

      // 2. Si tiene camión asociado en el perfil, actualizarlo en Base44
      if (option.truck?.id) {
        await base44.entities.Truck.update(option.truck.id, {
          conductor_nombre: driverName,
          estado: 'en_ruta',
        });
      }

      // 3. Construir borrador en Emails para el Broker y el Carrier
      const brokerEmail = loadToAssign.broker_email || '';
      const carrierEmail = loadToAssign.carrier_email || currentUser?.email || '';
      const refLabel = loadToAssign.numero_referencia ? ` (Ref: ${loadToAssign.numero_referencia})` : '';

      const draftSubject = `Confirmación de Despacho: ${loadToAssign.origen} → ${loadToAssign.destino}${refLabel}`;
      const draftBody = isEs
        ? `Hola equipo (${loadToAssign.broker_nombre || 'Broker'} & Carrier),\n\nConfirmamos la asignación de conductor y unidad para la carga:\n\n` +
          `• Ruta: ${loadToAssign.origen} → ${loadToAssign.destino} (${loadToAssign.millas || '--'} millas)\n` +
          `• Fecha de Recogida (Pickup): ${loadToAssign.fecha_carga || 'Confirmada'}\n` +
          `• Fecha de Entrega (Delivery): ${loadToAssign.fecha_entrega || 'Confirmada'}\n` +
          (loadToAssign.numero_referencia ? `• Load # / Referencia: ${loadToAssign.numero_referencia}\n` : '') +
          `• Tarifa Acordada: $${(loadToAssign.tarifa_negociada || 0).toLocaleString()}\n\n` +
          `DATOS DEL CONDUCTOR ASIGNADO:\n` +
          `• Conductor: ${driverName}${option.driverPhone ? ' (Tel: ' + option.driverPhone + ')' : ''}\n` +
          (placa ? `• Camión / Placa: ${placa}\n` : '') +
          `\nSaludos cordiales,\nDepartamento de Despacho — Trucky`
        : `Hello team (${loadToAssign.broker_nombre || 'Broker'} & Carrier),\n\nWe confirm the driver and unit assignment for the load:\n\n` +
          `• Route: ${loadToAssign.origen} → ${loadToAssign.destino} (${loadToAssign.millas || '--'} miles)\n` +
          `• Pickup Date: ${loadToAssign.fecha_carga || 'Confirmed'}\n` +
          `• Delivery Date: ${loadToAssign.fecha_entrega || 'Confirmed'}\n` +
          (loadToAssign.numero_referencia ? `• Load # / Reference: ${loadToAssign.numero_referencia}\n` : '') +
          `• Agreed Rate: $${(loadToAssign.tarifa_negociada || 0).toLocaleString()}\n\n` +
          `ASSIGNED DRIVER DETAILS:\n` +
          `• Driver: ${driverName}${option.driverPhone ? ' (Phone: ' + option.driverPhone + ')' : ''}\n` +
          (placa ? `• Truck / Plate: ${placa}\n` : '') +
          `\nBest regards,\nDispatch Department — Trucky`;

      sessionStorage.setItem(
        AUTOMATION_FLEET_TO_EMAIL_DRAFT_KEY,
        JSON.stringify({
          loadId: updatedLoad?.id || loadToAssign.id,
          origen: loadToAssign.origen,
          destino: loadToAssign.destino,
          brokerEmail,
          carrierEmail,
          conductorNombre: driverName,
          truckPlaca: placa,
          subject: draftSubject,
          content: draftBody,
          threadId: loadToAssign.thread_id || null,
        })
      );
      sessionStorage.removeItem(AUTOMATION_PENDING_DISPATCH_LOAD_KEY);
      window.dispatchEvent(new CustomEvent('notifications-updated'));

      navigate('/emails?dispatch_draft=1');
    } catch (err) {
      console.error('Error al elegir conductor:', err);
      toast({
        title: isEs ? 'Error al elegir conductor' : 'Failed to choose driver',
        description: err?.message || 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setAssigningDriver(false);
    }
  };

  const handleSave = async (data) => {
    try {
      const cleanData = { ...data, profile_id: String(activeProfileId || '1') };
      if (editTruck) {
        await base44.entities.Truck.update(editTruck.id, cleanData);
      } else {
        const created = await base44.entities.Truck.create(withOrg(orgId, cleanData));
        addTruckToProfile(created.id);
      }

      window.dispatchEvent(new CustomEvent('notifications-updated'));
      setShowForm(false);
      setEditTruck(null);
      loadData();
    } catch (err) {
      console.error('Error guardando camión:', err);
      alert('Error al guardar: ' + (err?.message || 'intente de nuevo'));
    }
  };

  const statusCount = (s) => trucks.filter(t => t.estado === s).length;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">{t.fleet.title}</h1>
          <p className="text-sm text-muted-foreground">{trucks.length} {t.fleet.trucks}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Solo mostrar el botón de elegir conductor en la esquina al lado de "+ Agregar camión" si existen conductores en este perfil */}
          {availableDriverOptions.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setDriverMenuOpen(prev => !prev)}
                disabled={assigningDriver}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-xs font-bold text-zinc-950 shadow-sm transition-all cursor-pointer disabled:opacity-50"
              >
                {assigningDriver ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-950" />
                ) : (
                  <UserCheck className="w-3.5 h-3.5" />
                )}
                <span>{isEs ? 'Elegir conductor' : 'Choose driver'}</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>

              {driverMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-56 rounded-xl bg-card border border-border shadow-xl z-40 py-1">
                  {availableDriverOptions.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelectAvailableDriver(opt)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors flex items-center justify-between gap-2"
                    >
                      <span className="font-semibold text-foreground truncate">{opt.driverName}</span>
                      {opt.placa && (
                        <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">
                          {opt.placa}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => {
              if (limits?.FLEET && trucks.length >= limits.FLEET) {
                setShowLimitModal(true);
                return;
              }
              setEditTruck(null);
              setShowForm(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground"
          >
            <Plus className="w-3.5 h-3.5" />{t.fleet.add}
          </button>
        </div>
      </div>

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
          {trucks.map(truck => (
            <div key={truck.id} className="bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-colors">
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
            </div>
          ))}
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
