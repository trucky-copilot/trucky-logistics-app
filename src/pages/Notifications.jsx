import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Bell, Plus, X, CheckCheck, AlertTriangle, Info, Zap, Truck, FileWarning, Trash2, Users, Building2, Package, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useOrganizationId } from '@/lib/AppStateContext';
import { listByOrg, withOrg } from '@/lib/orgScope';
import { useLanguage } from '@/lib/LanguageContext';
import { useProfile } from '@/lib/ProfileContext';
import { getOperationalAlerts } from '@/lib/operationalAlerts';

const TIPO_ICONS = {
  cambio_asignacion: Truck,
  retraso_ruta: AlertTriangle,
  mensaje_despacho: Zap,
  documento_vencido: FileWarning,
  alerta_tarifa: Info,
  general: Bell,
};

const TIPO_COLORS = {
  alta: 'border-l-red-400 bg-red-400/5',
  media: 'border-l-yellow-400 bg-yellow-400/5',
  baja: 'border-l-border bg-muted/20',
};

const TIPO_LABELS = {
  cambio_asignacion: 'Cambio de asignación',
  retraso_ruta: 'Retraso en ruta',
  mensaje_despacho: 'Mensaje de despacho',
  documento_vencido: 'Documento vencido',
  alerta_tarifa: 'Alerta de tarifa',
  general: 'General',
};

function NotifForm({ onSave, onClose }) {
  const { t, locale } = useLanguage();
  const { setUnsavedChanges } = useProfile();
  const initialState = { titulo: '', mensaje: '', tipo: 'general', prioridad: 'media' };
  const [form, setForm] = useState(initialState);
  const [isSaving, setIsSaving] = useState(false);
  
  useEffect(() => {
    const isUnsaved = JSON.stringify(form) !== JSON.stringify(initialState);
    setUnsavedChanges('NotifForm', isUnsaved);
    return () => setUnsavedChanges('NotifForm', false);
  }, [form, setUnsavedChanges]);

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
          <h2 className="text-base font-semibold">{t.notifications.formTitle}</h2>
          <button onClick={onClose} disabled={isSaving} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t.notifications.titleLabel} *</label>
            <input required value={form.titulo} onChange={e => set('titulo', e.target.value)} disabled={isSaving}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t.notifications.message} *</label>
            <textarea required value={form.mensaje} onChange={e => set('mensaje', e.target.value)} rows={3} disabled={isSaving}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none disabled:opacity-60" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.notifications.type}</label>
              <select value={form.tipo} onChange={e => set('tipo', e.target.value)} disabled={isSaving}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60">
                {Object.entries(TIPO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">{t.notifications.priority}</label>
              <select value={form.prioridad} onChange={e => set('prioridad', e.target.value)} disabled={isSaving}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60">
                <option value="alta">{t.notifications.high}</option>
                <option value="media">{t.notifications.medium}</option>
                <option value="baja">{locale === 'en' ? 'Low' : 'Baja'}</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={isSaving} className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">{t.notifications.cancel}</button>
            <button type="submit" disabled={isSaving} className="flex-1 py-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50 flex items-center justify-center gap-2">
              {isSaving ? (
                <>
                  <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                  <span>{locale === 'en' ? 'Sending...' : 'Enviando...'}</span>
                </>
              ) : (
                t.notifications.send
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Notifications() {
  const orgId = useOrganizationId();
  const { t, locale } = useLanguage();
  const { activeProfileId } = useProfile();
  const isEn = locale === 'en';

  const [dbNotifications, setDbNotifications] = useState([]);
  const [operationalAlerts, setOperationalAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('all');
  const isSavingRef = useRef(false);

  const getProfileIds = (entity) => {
    const key = `profile_${entity}_${orgId}_${activeProfileId}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  };

  const filterByProfile = (data, entity) => {
    const profileIds = getProfileIds(entity);
    return data.filter(item => {
      if (item.profile_id) return item.profile_id === activeProfileId;
      if (activeProfileId === '1' && profileIds === null) {
        const usedIds = [];
        for (let i = 2; i <= 5; i++) {
          const stored = localStorage.getItem(`profile_${entity}_${orgId}_${i}`);
          if (stored) usedIds.push(...JSON.parse(stored));
        }
        return !usedIds.includes(item.id);
      }
      if (profileIds !== null) return profileIds.includes(item.id);
      return false;
    });
  };

  const addNotifToProfile = (notifId) => {
    const key = `profile_notifs_${orgId}_${activeProfileId}`;
    const current = getProfileIds('notifs') || [];
    localStorage.setItem(key, JSON.stringify([...current, notifId]));
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [rawNotifs, rawTrucks, rawDrivers, rawBrokers, rawLoads] = await Promise.all([
        listByOrg(base44.entities.Notification, orgId, '-created_date', 100),
        listByOrg(base44.entities.Truck, orgId),
        listByOrg(base44.entities.Driver, orgId),
        listByOrg(base44.entities.Broker, orgId),
        listByOrg(base44.entities.Load, orgId, '-created_date', 50),
      ]);

      const trucks = filterByProfile(rawTrucks, 'trucks');
      const drivers = filterByProfile(rawDrivers, 'drivers');
      const brokers = filterByProfile(rawBrokers, 'brokers');
      const loads = filterByProfile(rawLoads, 'loads');

      const profileNotifIds = getProfileIds('notifs');
      let profileNotifs;
      if (activeProfileId === '1' && profileNotifIds === null) {
        const usedIds = [];
        for (let i = 2; i <= 5; i++) {
          const stored = localStorage.getItem(`profile_notifs_${orgId}_${i}`);
          if (stored) usedIds.push(...JSON.parse(stored));
        }
        const unclaimed = rawNotifs.filter(n => (!n.profile_id || n.profile_id === '1') && !usedIds.includes(n.id));
        const unclaimedIds = unclaimed.map(n => n.id);
        localStorage.setItem(`profile_notifs_${orgId}_1`, JSON.stringify(unclaimedIds));
        profileNotifs = rawNotifs.filter(n => n.profile_id === '1' || unclaimedIds.includes(n.id));
      } else {
        profileNotifs = rawNotifs.filter(n => {
          if (n.profile_id) return n.profile_id === activeProfileId;
          return profileNotifIds && profileNotifIds.includes(n.id);
        });
      }

      setDbNotifications(profileNotifs);

      // Calculamos todas las alertas operacionales rojas y amarillas de los 4 módulos + notifs
      const alerts = getOperationalAlerts({
        trucks,
        drivers,
        brokers,
        loads,
        notifications: profileNotifs,
        locale,
      });

      setOperationalAlerts(alerts);
    } catch (err) {
      console.error('Error cargando notificaciones y alertas:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [orgId, activeProfileId, locale]);

  const handleSave = async (data) => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    try {
      const created = await base44.entities.Notification.create(withOrg(orgId, {
        ...data,
        profile_id: activeProfileId || '1',
      }));
      addNotifToProfile(created.id);
      setShowForm(false);
      window.dispatchEvent(new CustomEvent('notifications-updated'));
      await loadData();
    } catch (err) {
      console.error('Error guardando notificación:', err);
      alert('Error al guardar: ' + (err?.message || 'intente de nuevo'));
    } finally {
      isSavingRef.current = false;
    }
  };

  const markRead = async (id) => {
    const cleanId = id.startsWith('sys-notif-') ? id.replace('sys-notif-', '') : id;
    await base44.entities.Notification.update(cleanId, { leido: true });
    setDbNotifications(prev => prev.map(n => n.id === cleanId ? { ...n, leido: true } : n));
    setOperationalAlerts(prev => prev.map(a => a.id === `sys-notif-${cleanId}` ? { ...a, leido: true } : a));
    window.dispatchEvent(new CustomEvent('notifications-updated'));
  };

  const markAllRead = async () => {
    const unread = dbNotifications.filter(n => !n.leido);
    await Promise.all(unread.map(n => base44.entities.Notification.update(n.id, { leido: true })));
    setDbNotifications(prev => prev.map(n => ({ ...n, leido: true })));
    setOperationalAlerts(prev => prev.map(a => a.modulo === 'sistema' ? { ...a, leido: true } : a));
    window.dispatchEvent(new CustomEvent('notifications-updated'));
  };

  const deleteNotification = async (id, e) => {
    if (e) e.stopPropagation();
    const cleanId = id.startsWith('sys-notif-') ? id.replace('sys-notif-', '') : id;
    try {
      await base44.entities.Notification.delete(cleanId);
      const key = `profile_notifs_${orgId}_${activeProfileId}`;
      const current = getProfileIds('notifs') || [];
      localStorage.setItem(key, JSON.stringify(current.filter(item => item !== cleanId)));
      setDbNotifications(prev => prev.filter(n => n.id !== cleanId));
      setOperationalAlerts(prev => prev.filter(a => a.id !== `sys-notif-${cleanId}` && a.id !== cleanId));
      window.dispatchEvent(new CustomEvent('notifications-updated'));
    } catch (err) {
      console.error('Error eliminando notificación:', err);
    }
  };

  // Filtrado de alertas operacionales
  const filtered = operationalAlerts.filter(a => {
    if (filter === 'all') return true;
    if (filter === 'rojo') return a.nivel === 'rojo';
    if (filter === 'amarillo') return a.nivel === 'amarillo';
    if (filter === 'flota') return a.modulo === 'flota';
    if (filter === 'conductores') return a.modulo === 'conductores';
    if (filter === 'brokers') return a.modulo === 'brokers';
    if (filter === 'cargas') return a.modulo === 'cargas';
    if (filter === 'sistema') return a.modulo === 'sistema';
    return true;
  });

  const criticalCount = operationalAlerts.filter(a => a.nivel === 'rojo').length;
  const warningCount = operationalAlerts.filter(a => a.nivel === 'amarillo').length;
  const unreadSysCount = dbNotifications.filter(n => !n.leido).length;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            {t.notifications.title}
            {operationalAlerts.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                {operationalAlerts.length}
              </span>
            )}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isEn
              ? 'Showing alerts in RED and YELLOW across all operational modules (green excluded).'
              : 'Mostrando alertas en ROJO y AMARILLO de todos los módulos (verdes excluidas).'}
          </p>
        </div>
        <div className="flex gap-2">
          {unreadSysCount > 0 && (
            <button onClick={markAllRead} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground">
              <CheckCheck className="w-3.5 h-3.5" />{t.notifications.markAll}
            </button>
          )}
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground">
            <Plus className="w-3.5 h-3.5" />{t.notifications.new}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1.5 flex-wrap">
        {[
          { key: 'all', label: `${t.notifications.all} (${operationalAlerts.length})` },
          { key: 'rojo', label: `🔴 ${isEn ? 'Critical' : 'Rojas'} (${criticalCount})` },
          { key: 'amarillo', label: `🟡 ${isEn ? 'Warnings' : 'Amarillas'} (${warningCount})` },
          { key: 'flota', label: `🚚 ${isEn ? 'Fleet' : 'Flota'}` },
          { key: 'conductores', label: `👤 ${isEn ? 'Drivers' : 'Conductores'}` },
          { key: 'brokers', label: `🏢 Brokers` },
          { key: 'cargas', label: `📦 ${isEn ? 'Loads' : 'Cargas'}` },
          { key: 'sistema', label: `🔔 ${isEn ? 'Messages' : 'Mensajes'}` },
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

      {showForm && <NotifForm onSave={handleSave} onClose={() => setShowForm(false)} />}

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground bg-card border border-border rounded-2xl">
          <Bell className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm font-medium">{t.dashboard.allInOrder || 'Todo en orden'}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {isEn ? 'No pending red or yellow alerts for this filter.' : 'No hay alertas rojas ni amarillas pendientes en este filtro.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(alert => {
            const isRed = alert.nivel === 'rojo';
            const IconComponent =
              alert.icon === 'Truck' || alert.modulo === 'flota' ? Truck :
              alert.icon === 'Users' || alert.modulo === 'conductores' ? Users :
              alert.icon === 'Building2' || alert.modulo === 'brokers' ? Building2 :
              alert.icon === 'Package' || alert.modulo === 'cargas' ? Package :
              alert.icon === 'FileWarning' ? FileWarning :
              alert.icon === 'AlertTriangle' ? AlertTriangle :
              TIPO_ICONS[alert.icon] || Bell;

            const isSys = alert.modulo === 'sistema';

            return (
              <div
                key={alert.id}
                className={`rounded-xl border-l-4 border p-4 transition-all ${
                  isRed ? 'border-l-red-400 bg-red-400/5 border-border' : 'border-l-yellow-400 bg-yellow-400/5 border-border'
                } ${isSys && alert.leido ? 'opacity-70' : ''}`}
                onClick={() => {
                  if (isSys && !alert.leido) {
                    markRead(alert.id);
                  }
                }}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isRed ? 'bg-red-400/20 text-red-400' : 'bg-yellow-400/20 text-yellow-400'
                  }`}>
                    <IconComponent className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{alert.titulo}</p>
                        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded flex-shrink-0 ${
                          isRed ? 'text-red-400 bg-red-400/10' : 'text-yellow-400 bg-yellow-400/10'
                        }`}>
                          {alert.moduloLabel || alert.modulo}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {alert.link && alert.link !== '/notificaciones' ? (
                          <Link
                            to={alert.link}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                          >
                            <span>{isEn ? 'View' : 'Ver'}</span>
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        ) : null}
                        {isSys ? (
                          <button
                            type="button"
                            onClick={(e) => deleteNotification(alert.id, e)}
                            title={isEn ? 'Delete notification' : 'Eliminar notificación'}
                            className="p-1 rounded-md hover:bg-muted text-muted-foreground/60 hover:text-red-400 transition-colors ml-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <p className={`text-xs mt-1 ${isRed ? 'text-red-400 font-medium' : 'text-yellow-400/90'}`}>
                      {isRed ? '🔴' : '🟡'} {alert.mensaje}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}