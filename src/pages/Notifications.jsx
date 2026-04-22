import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Bell, Plus, X, CheckCheck, AlertTriangle, Info, Zap, Truck, FileWarning } from 'lucide-react';

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
  const [form, setForm] = useState({ titulo: '', mensaje: '', tipo: 'general', prioridad: 'media' });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const handleSubmit = (e) => { e.preventDefault(); onSave(form); };
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Nueva Notificación</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Título *</label>
            <input required value={form.titulo} onChange={e => set('titulo', e.target.value)}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Mensaje *</label>
            <textarea required value={form.mensaje} onChange={e => set('mensaje', e.target.value)} rows={3}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tipo</label>
              <select value={form.tipo} onChange={e => set('tipo', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50">
                {Object.entries(TIPO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Prioridad</label>
              <select value={form.prioridad} onChange={e => set('prioridad', e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50">
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground">Cancelar</button>
            <button type="submit" className="flex-1 py-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground">Enviar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('all');

  const loadData = async () => {
    const data = await base44.entities.Notification.list('-created_date', 100);
    setNotifications(data);
    setLoading(false);
  };
  useEffect(() => { loadData(); }, []);

  const handleSave = async (data) => {
    await base44.entities.Notification.create(data);
    setShowForm(false);
    loadData();
  };

  const markRead = async (id) => {
    await base44.entities.Notification.update(id, { leido: true });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, leido: true } : n));
  };

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.leido);
    await Promise.all(unread.map(n => base44.entities.Notification.update(n.id, { leido: true })));
    setNotifications(prev => prev.map(n => ({ ...n, leido: true })));
  };

  const filtered = filter === 'all' ? notifications : filter === 'unread' ? notifications.filter(n => !n.leido) : notifications.filter(n => n.prioridad === filter);
  const unreadCount = notifications.filter(n => !n.leido).length;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            Notificaciones
            {unreadCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-bold">{unreadCount}</span>
            )}
          </h1>
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground">
              <CheckCheck className="w-3.5 h-3.5" />Marcar todas
            </button>
          )}
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground">
            <Plus className="w-3.5 h-3.5" />Nueva
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1.5 flex-wrap">
        {[{ key: 'all', label: 'Todas' }, { key: 'unread', label: 'Sin leer' }, { key: 'alta', label: '🔴 Alta' }, { key: 'media', label: '🟡 Media' }].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filter === f.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {showForm && <NotifForm onSave={handleSave} onClose={() => setShowForm(false)} />}

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Bell className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No hay notificaciones</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(notif => {
            const Icon = TIPO_ICONS[notif.tipo] || Bell;
            const timeAgo = (() => {
              const diff = Date.now() - new Date(notif.created_date).getTime();
              const h = Math.floor(diff / 3600000);
              if (h < 1) return 'hace un momento';
              if (h < 24) return `hace ${h}h`;
              return `hace ${Math.floor(h / 24)}d`;
            })();
            return (
              <div key={notif.id}
                className={`rounded-xl border-l-4 border border-border p-4 transition-all cursor-pointer ${
                  TIPO_COLORS[notif.prioridad] || TIPO_COLORS.baja
                } ${!notif.leido ? 'ring-1 ring-primary/20' : 'opacity-70'}`}
                onClick={() => !notif.leido && markRead(notif.id)}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    notif.prioridad === 'alta' ? 'bg-red-400/20' : notif.prioridad === 'media' ? 'bg-yellow-400/20' : 'bg-muted'
                  }`}>
                    <Icon className={`w-4 h-4 ${notif.prioridad === 'alta' ? 'text-red-400' : notif.prioridad === 'media' ? 'text-yellow-400' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm font-medium ${notif.leido ? 'text-muted-foreground' : 'text-foreground'}`}>{notif.titulo}</p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs text-muted-foreground">{timeAgo}</span>
                        {!notif.leido && <div className="w-2 h-2 rounded-full bg-primary" />}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{notif.mensaje}</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">{TIPO_LABELS[notif.tipo]}</p>
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