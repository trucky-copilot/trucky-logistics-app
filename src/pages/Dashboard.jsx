import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { DollarSign, Truck, Package, TrendingUp, AlertTriangle, CheckCircle2, XCircle, Bell, Info, Zap, FileWarning } from 'lucide-react';

const TIPO_ICONS = {
  cambio_asignacion: Truck,
  retraso_ruta: AlertTriangle,
  mensaje_despacho: Zap,
  documento_vencido: FileWarning,
  alerta_tarifa: Info,
  general: Bell,
};
import KpiCard from '@/components/KpiCard';
import StatusBadge from '@/components/StatusBadge';
import OperationalStatusCard from '@/components/OperationalStatusCard';
import LoadsMap from '@/components/dashboard/LoadsMap';
import { Link } from 'react-router-dom';
import { useOrganizationId, useAppState } from '@/lib/AppStateContext';
import { useLanguage } from '@/lib/LanguageContext';
import { listByOrg } from '@/lib/orgScope';
import { useProfile } from '@/lib/ProfileContext';

export default function Dashboard() {
  const orgId = useOrganizationId();
  const { organization, currentUser } = useAppState();
  const { t, locale } = useLanguage();
  const { activeProfileId } = useProfile();
  const [trucks, setTrucks] = useState([]);
  const [loads, setLoads] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [costConfig, setCostConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * Obtiene los IDs guardados en localStorage para el perfil activo.
   * Mismo mecanismo que usan Fleet, Drivers, Loads y Brokers.
   */
  const getProfileIds = (entity) => {
    const key = `profile_${entity}_${orgId}_${activeProfileId}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  };

  const filterByProfile = (data, entity) => {
    const profileIds = getProfileIds(entity);
    if (activeProfileId === '1' && profileIds === null) {
      const usedIds = [];
      for (let i = 2; i <= 5; i++) {
        const stored = localStorage.getItem(`profile_${entity}_${orgId}_${i}`);
        if (stored) usedIds.push(...JSON.parse(stored));
      }
      return data.filter(item => !usedIds.includes(item.id));
    }
    if (profileIds !== null) return data.filter(item => profileIds.includes(item.id));
    return []; // Perfil nuevo sin datos
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      listByOrg(base44.entities.Truck, orgId),
      listByOrg(base44.entities.Load, orgId, '-created_date', 50),
      listByOrg(base44.entities.Broker, orgId),
      listByOrg(base44.entities.Driver, orgId),
      listByOrg(base44.entities.Notification, orgId, '-created_date', 10),
      currentUser?.email ? base44.entities.CostConfig.filter({ usuario: currentUser.email }) : Promise.resolve([]),
    ]).then(([rawTrucks, rawLoads, rawBrokers, rawDrivers, rawNotifs, configs]) => {
      setTrucks(filterByProfile(rawTrucks, 'trucks'));
      setLoads(filterByProfile(rawLoads, 'loads'));
      setBrokers(filterByProfile(rawBrokers, 'brokers'));
      setDrivers(filterByProfile(rawDrivers, 'drivers'));
      
      const notifIds = getProfileIds('notifs') || [];
      const filteredNotifs = activeProfileId === '1' && notifIds.length === 0 
        ? rawNotifs // Perfil 1 hereda todo si no tiene reclamos
        : rawNotifs.filter(n => notifIds.includes(n.id));
      setNotifications(filteredNotifs);

      if (configs && configs.length > 0) {
        setCostConfig(configs[0]);
      } else {
        setCostConfig(null);
      }
    }).catch((err) => {
      console.error('Dashboard: error al cargar datos', err);
      setError(t.dashboard.error);
    }).finally(() => {
      setLoading(false);
    });
  }, [orgId, activeProfileId]);

  // KPI calculations
  const thisWeek = loads.filter(l => {
    const d = new Date(l.created_date);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return d >= weekAgo;
  });

  const totalRevenue = thisWeek.reduce((s, l) => s + (l.tarifa_negociada || 0), 0);
  const totalProfit = thisWeek.reduce((s, l) => s + (l.ganancia_estimada || 0), 0);
  const totalMilesThisWeek = thisWeek.reduce((s, l) => s + (l.millas || 0), 0);
  const avgRatePerMile = totalMilesThisWeek > 0 ? totalRevenue / totalMilesThisWeek : 0;
  // Expiring documents
  const today = new Date();
  const sevenDays = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const thirtyDays = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiringDocs = drivers.flatMap(d => {
    const alerts = [];
    const fields = [
      { key: 'licencia_vencimiento', label: locale === 'en' ? 'License' : 'Licencia' },
      { key: 'medico_vencimiento', label: locale === 'en' ? 'Medical' : 'Médico' },
      { key: 'twic_vencimiento', label: 'TWIC' },
    ];
    fields.forEach(({ key, label }) => {
      if (d[key]) {
        const exp = new Date(d[key]);
        if (exp <= thirtyDays) {
          const urgent = exp <= sevenDays;
          alerts.push({ driver: `${d.nombre} ${d.apellido || ''}`.trim(), doc: label, date: d[key], expired: exp < today, urgent });
        }
      }
    });
    return alerts;
  });

  const recentLoads = loads.slice(0, 8);

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
      <AlertTriangle className="w-8 h-8 text-red-400" />
      <p className="text-sm text-foreground font-medium">{error}</p>
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">{t.dashboard.title}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{organization?.name || t.dashboard.organization}</p>
      </div>

      {/* Estado operativo (solo visible si la config está incompleta) */}
      <OperationalStatusCard />

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          titulo={t.dashboard.weeklyRevenue}
          valor={`$${totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          subtitulo={`${thisWeek.length} ${t.dashboard.loads}`}
          icon={DollarSign}
          color="cyan"
        />
        <KpiCard
          titulo={t.dashboard.netProfit}
          valor={`$${totalProfit.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          subtitulo={t.dashboard.estimatedThisWeek}
          icon={TrendingUp}
          color={totalProfit >= 0 ? 'green' : 'red'}
        />
        <KpiCard
          titulo={t.dashboard.averageRate}
          valor={avgRatePerMile > 0 ? `$${avgRatePerMile.toFixed(2)}` : '--'}
          subtitulo={costConfig?.tarifa_objetivo ? `meta: $${costConfig.tarifa_objetivo.toFixed(2)}/milla` : t.dashboard.target}
          icon={Package}
          color={
            costConfig?.tarifa_objetivo
              ? (avgRatePerMile >= costConfig.tarifa_objetivo ? 'green' : avgRatePerMile >= costConfig.tarifa_objetivo * 0.9 ? 'yellow' : 'red')
              : (avgRatePerMile >= 3 ? 'green' : avgRatePerMile >= 2.6 ? 'yellow' : 'red')
          }
        />
        <KpiCard
          titulo={t.dashboard.weeklyTrips}
          valor={thisWeek.length}
          subtitulo={`${loads.filter(l => l.estado === 'en_transito').length} ${t.dashboard.inTransitNow}`}
          icon={Truck}
          color="violet"
        />
      </div>

      {/* Mapa de rutas */}
      <LoadsMap loads={loads.slice(0, 15)} />

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Fleet Status */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">{t.dashboard.fleetStatus}</h2>
            <Link to="/flota" className="text-xs text-primary hover:underline">{t.dashboard.viewAll}</Link>
          </div>
          {trucks.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">{t.dashboard.noTrucks}</div>
          ) : (
            <div className="space-y-2">
              {trucks.slice(0, 6).map(truck => (
                <div key={truck.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                  <div>
                    <div className="text-sm font-medium text-foreground">{truck.placa}</div>
                    <div className="text-xs text-muted-foreground">{truck.conductor_nombre || t.dashboard.noDriver}</div>
                  </div>
                  <StatusBadge status={truck.estado} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Document Alerts and Notifications */}
        <div className={`rounded-xl p-4 border ${expiringDocs.some(a => a.urgent || a.expired) || notifications.some(n => n.prioridad === 'Alta') ? 'bg-red-400/5 border-red-400/30' : 'bg-card border-border'}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className={`text-sm font-semibold ${(expiringDocs.some(a => a.urgent || a.expired) || notifications.some(n => n.prioridad === 'Alta')) ? 'text-red-400' : 'text-foreground'}`}>
              {(expiringDocs.some(a => a.urgent || a.expired) || notifications.some(n => n.prioridad === 'Alta')) ? '🔴 Alertas y Notificaciones' : 'Alertas y Notificaciones'}
            </h2>
            <Link to="/notificaciones" className="text-xs text-primary hover:underline">{t.dashboard.viewAll}</Link>
          </div>
          {expiringDocs.length === 0 && notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <CheckCircle2 className="w-8 h-8 text-green-400 mb-2" />
              <p className="text-sm text-muted-foreground">Todo está en orden</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1 custom-scrollbar">
              {/* Notificaciones */}
              {notifications.slice(0, 20).map((notif) => {
                const isError = notif.prioridad === 'Alta' || notif.tipo === 'Documento vencido' || notif.tipo === 'Alerta de tarifa' || notif.prioridad === 'alta';
                const isWarning = notif.prioridad === 'Media' || notif.tipo === 'Retraso en ruta' || notif.prioridad === 'media';
                const Icon = TIPO_ICONS[notif.tipo] || Bell;
                return (
                  <div key={notif.id} className={`flex items-start gap-3 p-3 rounded-xl border-l-4 border border-border transition-all ${isError ? 'border-l-red-400 bg-red-400/5' : isWarning ? 'border-l-yellow-400 bg-yellow-400/5' : 'border-l-border bg-muted/20'} ${!notif.leido ? 'ring-1 ring-primary/20' : 'opacity-80'}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isError ? 'bg-red-400/20' : isWarning ? 'bg-yellow-400/20' : 'bg-muted'}`}>
                      <Icon className={`w-4 h-4 ${isError ? 'text-red-400' : isWarning ? 'text-yellow-400' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className={`text-xs font-semibold ${!notif.leido ? 'text-foreground' : 'text-muted-foreground'}`}>{notif.titulo}</p>
                        {!notif.leido && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{notif.mensaje}</p>
                    </div>
                  </div>
                );
              })}
              
              {/* Alertas de Documentos */}
              {expiringDocs.slice(0, 20).map((alert, i) => (
                <div key={`doc-${i}`} className={`flex items-start gap-3 p-3 rounded-xl border-l-4 border border-border transition-all ${alert.expired || alert.urgent ? 'border-l-red-400 bg-red-400/5 opacity-80' : 'border-l-yellow-400 bg-yellow-400/5 opacity-80'}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${alert.expired || alert.urgent ? 'bg-red-400/20' : 'bg-yellow-400/20'}`}>
                    <FileWarning className={`w-4 h-4 ${alert.expired || alert.urgent ? 'text-red-400' : 'text-yellow-400'}`} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">{alert.driver}</p>
                    <p className="text-xs text-muted-foreground">{alert.doc} — {alert.expired ? `🔴 ${t.dashboard.expired}` : alert.urgent ? `🔴 ${t.dashboard.expires}: ${alert.date}` : `⚠ ${t.dashboard.expires}: ${alert.date}`}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Broker Scoreboard */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">{t.dashboard.topBrokers}</h2>
            <Link to="/brokers" className="text-xs text-primary hover:underline">{t.dashboard.viewAll}</Link>
          </div>
          {brokers.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">{t.dashboard.noBrokers}</div>
          ) : (
            <div className="space-y-2">
              {brokers.slice(0, 5).map((b, i) => (
                <div key={b.id} className="flex items-center gap-2.5 py-1.5 border-b border-border/50 last:border-0">
                  <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{b.nombre}</div>
                    <div className="text-xs text-muted-foreground">{b.cargas_realizadas || 0} cargas</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono font-medium text-foreground">${b.tarifa_promedio?.toFixed(2) || '--'}/mi</div>
                    <div className={`text-xs font-medium ${(b.puntaje_confiabilidad || 0) >= 7 ? 'text-green-400' : (b.puntaje_confiabilidad || 0) >= 5 ? 'text-yellow-400' : 'text-red-400'}`}>
                      ★ {b.puntaje_confiabilidad || '--'}/10
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>



      {/* Recent Loads Table */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">{t.dashboard.recentLoads}</h2>
          <Link to="/cargas" className="text-xs text-primary hover:underline">{t.dashboard.viewAllLoads}</Link>
        </div>
        {recentLoads.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">{t.dashboard.noLoads}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left pb-2 font-medium">{t.dashboard.route}</th>
                  <th className="text-left pb-2 font-medium hidden sm:table-cell">{t.dashboard.broker}</th>
                  <th className="text-right pb-2 font-medium hidden md:table-cell">{t.dashboard.miles}</th>
                  <th className="text-right pb-2 font-medium">$/mi</th>
                  <th className="text-right pb-2 font-medium">{t.dashboard.total}</th>
                  <th className="text-right pb-2 font-medium hidden sm:table-cell">{t.dashboard.result}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {recentLoads.map(load => (
                  <tr key={load.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-2 text-foreground">
                      <div className="font-medium text-xs">{load.origen}</div>
                      <div className="text-muted-foreground text-xs">→ {load.destino}</div>
                    </td>
                    <td className="py-2 text-muted-foreground hidden sm:table-cell text-xs">{load.broker_nombre || '--'}</td>
                    <td className="py-2 text-right text-muted-foreground hidden md:table-cell text-xs font-mono">{load.millas || '--'}</td>
                    <td className={`py-2 text-right font-mono text-xs font-medium ${
                      (load.revenue_por_milla || 0) >= 3 ? 'text-green-400' : 
                      (load.revenue_por_milla || 0) >= 2.6 ? 'text-yellow-400' : 'text-red-400'
                    }`}>${load.revenue_por_milla?.toFixed(2) || '--'}</td>
                    <td className="py-2 text-right font-mono text-xs text-foreground">${(load.tarifa_negociada || 0).toLocaleString()}</td>
                    <td className="py-2 text-right hidden sm:table-cell">
                      <StatusBadge status={load.resultado || 'break_even'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}