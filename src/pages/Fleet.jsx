import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Truck, Plus, X, Pencil } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import { useOrganizationId } from '@/lib/AppStateContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useProfile } from '@/lib/ProfileContext';
import { listByOrg, withOrg } from '@/lib/orgScope';

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
  
  useEffect(() => {
    const isUnsaved = JSON.stringify(form) !== JSON.stringify(initialState);
    setUnsavedChanges('FleetForm', isUnsaved);
    return () => setUnsavedChanges('FleetForm', false);
  }, [form, truck, setUnsavedChanges]);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const handleSubmit = (e) => { e.preventDefault(); onSave(form); };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">{truck ? t.fleet.edit : t.fleet.new}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
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
                {ESTADOS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Tipo de equipo
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
            <button type="button" onClick={onClose} className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground">{t.fleet.cancel}</button>
            <button type="submit" className="flex-1 py-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground">{t.fleet.save}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Fleet() {
  const { t } = useLanguage();
  const orgId = useOrganizationId();
  const { activeProfileId } = useProfile();
  const [trucks, setTrucks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTruck, setEditTruck] = useState(null);

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

  const loadData = async () => {
    setLoading(true);
    const data = await listByOrg(base44.entities.Truck, orgId);
    const profileIds = getProfileTruckIds();
    
    let filtered;
    if (activeProfileId === '1' && profileIds === null) {
      // Perfil 1 sin lista: inicializamos con todos los IDs que NO pertenezcan a otros perfiles
      const usedIds = [];
      for (let i = 2; i <= 5; i++) {
        const stored = localStorage.getItem(`profile_trucks_${orgId}_${i}`);
        if (stored) usedIds.push(...JSON.parse(stored));
      }
      const unclaimedIds = data.map(t => t.id).filter(id => !usedIds.includes(id));
      const key = `profile_trucks_${orgId}_1`;
      localStorage.setItem(key, JSON.stringify(unclaimedIds));
      filtered = data.filter(t => unclaimedIds.includes(t.id));
    } else if (profileIds !== null) {
      filtered = data.filter(t => profileIds.includes(t.id));
    } else {
      filtered = [];
    }
    
    setTrucks(filtered);
    setLoading(false);
  };
  useEffect(() => { loadData(); }, [orgId, activeProfileId]);

  const handleSave = async (data) => {
    try {
      const { profile_id: _, ...cleanData } = data;
      if (editTruck) {
        await base44.entities.Truck.update(editTruck.id, cleanData);
      } else {
        const created = await base44.entities.Truck.create(withOrg(orgId, cleanData));
        addTruckToProfile(created.id);
      }
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
        <button onClick={() => { setEditTruck(null); setShowForm(true); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground">
          <Plus className="w-3.5 h-3.5" />{t.fleet.add}
        </button>
      </div>

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
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>{t.fleet.assignedDriver}:</span>
                  <span className="text-foreground">{truck.conductor_nombre || t.fleet.noAssigned}</span>
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
    </div>
  );
}