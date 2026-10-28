import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import {
  DollarSign, Truck, Package, TrendingUp, AlertTriangle,
  CheckCircle2, Bell, Info, Zap, FileWarning, Building2, Users,
  Sparkles, ArrowUpRight, Layers, Activity
} from 'lucide-react';
import { getOperationalAlerts } from '@/lib/operationalAlerts';
import KpiCard from '@/components/KpiCard';
import StatusBadge from '@/components/StatusBadge';
import OperationalStatusCard from '@/components/OperationalStatusCard';
import DashboardGoogleMap from '@/components/DashboardGoogleMap';
import { Link } from 'react-router-dom';
import { useOrganizationId, useAppState } from '@/lib/AppStateContext';
import { useLanguage } from '@/lib/LanguageContext';
import { listByOrg } from '@/lib/orgScope';
import { useProfile } from '@/lib/ProfileContext';

const TIPO_ICONS = {
  cambio_asignacion: Truck,
  retraso_ruta: AlertTriangle,
  mensaje_despacho: Zap,
  documento_vencido: FileWarning,
  alerta_tarifa: Info,
  general: Bell,
};

const SECTION_TRANSITION = {
  initial: { opacity: 0, y: 12, filter: 'blur(8px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -10, filter: 'blur(6px)' },
  transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
};

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
  const [activeSection, setActiveSection] = useState('overview');

  const isEs = locale !== 'en';

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
    return data.filter(item => {
      if (item.profile_id) {
        return item.profile_id === activeProfileId;
      }
      if (activeProfileId === '1' && profileIds === null) {
        const usedIds = [];
        for (let i = 2; i <= 5; i++) {
          const stored = localStorage.getItem(`profile_${entity}_${orgId}_${i}`);
          if (stored) usedIds.push(...JSON.parse(stored));
        }
        return !usedIds.includes(item.id);
      }
      if (profileIds !== null) {
        return profileIds.includes(item.id);
      }
      return false;
    });
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
      const filteredNotifs = rawNotifs.filter(n => {
        if (n.profile_id) return n.profile_id === activeProfileId;
        if (activeProfileId === '1' && notifIds.length === 0) return true;
        return notifIds.includes(n.id);
      });
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

  // ── Cálculos intactos de KPIs ────────────────────────────────────────────────
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

  const operationalAlerts = getOperationalAlerts({
    trucks,
    drivers,
    brokers,
    loads,
    notifications,
    locale,
  });

  const hasCriticalAlerts = operationalAlerts.some(a => a.nivel === 'rojo');
  const hasWarningAlerts = operationalAlerts.some(a => a.nivel === 'amarillo');

  const recentLoads = loads.slice(0, 8);

  const SECTIONS = [
    { id: 'overview', label: isEs ? 'Vista General' : 'Overview', icon: Layers },
    { id: 'operations', label: isEs ? 'Flota y Alertas' : 'Fleet & Alerts', icon: Activity },
    { id: 'loads', label: isEs ? 'Actividad de Cargas' : 'Recent Loads', icon: Package },
  ];

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

  const renderOperationalPanels = () => (
    <div className="grid lg:grid-cols-3 gap-4">
      {/* Fleet Status */}
      <motion.div
        whileHover={{ y: -4 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        className="glass-panel rounded-2xl p-5 relative overflow-hidden"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#5B2BA0]/45 border border-white/15 flex items-center justify-center">
              <Truck className="w-3.5 h-3.5 text-white" />
            </div>
            <h2 className="text-sm font-semibold text-white">{t.dashboard.fleetStatus}</h2>
          </div>
          <Link to="/flota" className="text-xs text-violet-300 hover:text-white flex items-center gap-0.5 transition-colors">
            {t.dashboard.viewAll}
            <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        {trucks.length === 0 ? (
          <div className="text-center py-8 text-white/55 text-sm">{t.dashboard.noTrucks}</div>
        ) : (
          <div className="space-y-2">
            {trucks.slice(0, 6).map(truck => (
              <div
                key={truck.id}
                className="flex items-center justify-between py-2 px-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] transition-colors"
              >
                <div>
                  <div className="text-sm font-medium text-white">{truck.placa}</div>
                  <div className="text-xs text-white/60">{truck.conductor_nombre || t.dashboard.noDriver}</div>
                </div>
                <StatusBadge status={truck.estado} />
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Document Alerts and Notifications */}
      <motion.div
        whileHover={{ y: -4 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        className={`glass-panel rounded-2xl p-5 relative overflow-hidden ${
          hasCriticalAlerts
            ? 'border-red-400/35 shadow-red-950/30'
            : hasWarningAlerts
            ? 'border-amber-400/35 shadow-amber-950/30'
            : ''
        }`}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-sm font-semibold ${hasCriticalAlerts ? 'text-red-300' : hasWarningAlerts ? 'text-amber-300' : 'text-white'}`}>
            {hasCriticalAlerts
              ? `🔴 ${t.dashboard.alertsAndNotifications}`
              : hasWarningAlerts
              ? `🟡 ${t.dashboard.alertsAndNotifications}`
              : t.dashboard.alertsAndNotifications}
          </h2>
          <Link to="/notificaciones" className="text-xs text-violet-300 hover:text-white flex items-center gap-0.5 transition-colors">
            {t.dashboard.viewAll}
            <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        {operationalAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center mb-2.5">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <p className="text-sm text-white/70">{t.dashboard.allInOrder}</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[230px] overflow-y-auto pr-1 custom-scrollbar">
            {operationalAlerts.slice(0, 30).map((alert) => {
              const isRed = alert.nivel === 'rojo';
              const IconComponent =
                alert.icon === 'Truck' || alert.modulo === 'flota' ? Truck :
                alert.icon === 'Users' || alert.modulo === 'conductores' ? Users :
                alert.icon === 'Building2' || alert.modulo === 'brokers' ? Building2 :
                alert.icon === 'Package' || alert.modulo === 'cargas' ? Package :
                alert.icon === 'FileWarning' ? FileWarning :
                alert.icon === 'AlertTriangle' ? AlertTriangle :
                TIPO_ICONS[alert.icon] || Bell;

              return (
                <Link
                  key={alert.id}
                  to={alert.link || '/notificaciones'}
                  className={`flex items-start gap-3 p-3 rounded-xl border-l-4 border backdrop-blur-md transition-all hover:translate-x-0.5 ${
                    isRed
                      ? 'border-l-red-400 bg-red-500/10 border-white/10 hover:bg-red-500/15'
                      : 'border-l-amber-400 bg-amber-500/10 border-white/10 hover:bg-amber-500/15'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isRed ? 'bg-red-400/20' : 'bg-amber-400/20'
                  }`}>
                    <IconComponent className={`w-4 h-4 ${isRed ? 'text-red-300' : 'text-amber-300'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1.5">
                      <p className="text-xs font-semibold text-white truncate">{alert.titulo}</p>
                      <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0 ${
                        isRed ? 'text-red-300 bg-red-400/15' : 'text-amber-300 bg-amber-400/15'
                      }`}>
                        {alert.moduloLabel || alert.modulo}
                      </span>
                    </div>
                    <p className={`text-xs mt-0.5 ${isRed ? 'text-red-300' : 'text-amber-200/90'}`}>
                      {isRed ? '🔴' : '🟡'} {alert.mensaje}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Broker Scoreboard */}
      <motion.div
        whileHover={{ y: -4 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        className="glass-panel rounded-2xl p-5 relative overflow-hidden"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#5B2BA0]/45 border border-white/15 flex items-center justify-center">
              <Building2 className="w-3.5 h-3.5 text-white" />
            </div>
            <h2 className="text-sm font-semibold text-white">{t.dashboard.topBrokers}</h2>
          </div>
          <Link to="/brokers" className="text-xs text-violet-300 hover:text-white flex items-center gap-0.5 transition-colors">
            {t.dashboard.viewAll}
            <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        {brokers.length === 0 ? (
          <div className="text-center py-8 text-white/55 text-sm">{t.dashboard.noBrokers}</div>
        ) : (
          <div className="space-y-2">
            {brokers.slice(0, 5).map((b, i) => (
              <div
                key={b.id}
                className="flex items-center gap-2.5 py-2 px-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] transition-colors"
              >
                <span className="text-xs font-bold text-violet-300 w-5 h-5 rounded-md bg-[#5B2BA0]/40 border border-white/10 flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{b.nombre}</div>
                  <div className="text-xs text-white/60">{b.cargas_realizadas || 0} {t.dashboard.loads}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-mono font-medium text-white">${b.tarifa_promedio?.toFixed(2) || '--'}/mi</div>
                  <div className={`text-xs font-medium ${(b.puntaje_confiabilidad || 0) >= 7 ? 'text-emerald-400' : (b.puntaje_confiabilidad || 0) >= 5 ? 'text-amber-400' : 'text-red-400'}`}>
                    ★ {b.puntaje_confiabilidad || '--'}/10
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );

  const renderRecentLoadsPanel = () => (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      className="glass-panel rounded-2xl p-5 relative overflow-hidden"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#5B2BA0]/45 border border-white/15 flex items-center justify-center">
            <Package className="w-3.5 h-3.5 text-white" />
          </div>
          <h2 className="text-sm font-semibold text-white">{t.dashboard.recentLoads}</h2>
        </div>
        <Link to="/cargas" className="text-xs text-violet-300 hover:text-white flex items-center gap-0.5 transition-colors">
          {t.dashboard.viewAllLoads}
          <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>
      {recentLoads.length === 0 ? (
        <div className="text-center py-8 text-white/55 text-sm">{t.dashboard.noLoads}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-white/60 border-b border-white/10 bg-white/[0.03]">
                <th className="text-left py-2.5 px-3 font-medium rounded-tl-lg">{t.dashboard.route}</th>
                <th className="text-left py-2.5 px-3 font-medium hidden sm:table-cell">{t.dashboard.broker}</th>
                <th className="text-right py-2.5 px-3 font-medium hidden md:table-cell">{t.dashboard.miles}</th>
                <th className="text-right py-2.5 px-3 font-medium">$/mi</th>
                <th className="text-right py-2.5 px-3 font-medium rounded-tr-lg">{t.dashboard.total}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {recentLoads.map(load => (
                <tr key={load.id} className="hover:bg-white/[0.06] transition-colors">
                  <td className="py-2.5 px-3 text-white">
                    <div className="font-medium text-xs">{load.origen}</div>
                    <div className="text-white/60 text-xs">→ {load.destino}</div>
                  </td>
                  <td className="py-2.5 px-3 text-white/70 hidden sm:table-cell text-xs">{load.broker_nombre || '--'}</td>
                  <td className="py-2.5 px-3 text-right text-white/70 hidden md:table-cell text-xs font-mono">{load.millas || '--'}</td>
                  <td className={`py-2.5 px-3 text-right font-mono text-xs font-medium ${
                    (load.revenue_por_milla || 0) >= 3 ? 'text-emerald-400' :
                    (load.revenue_por_milla || 0) >= 2.6 ? 'text-amber-400' : 'text-red-400'
                  }`}>${load.revenue_por_milla?.toFixed(2) || '--'}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs font-semibold text-white">${(load.tarifa_negociada || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );

  return (
    <div className="relative min-h-full p-4 md:p-6 space-y-6 overflow-hidden">
      {/* Resplandores ambientales morados (#5B2BA0) detrás del vidrio esmerilado */}
      <div className="pointer-events-none fixed top-20 left-1/3 w-96 h-96 rounded-full bg-[#5B2BA0]/25 blur-[120px] -z-10" />
      <div className="pointer-events-none fixed bottom-12 right-16 w-80 h-80 rounded-full bg-[#5B2BA0]/20 blur-[110px] -z-10" />

      {/* Encabezado Estilo Glassy Dashboard + Selector de Sección con Desenfoque Suave */}
      <div className="glass-panel rounded-2xl p-4 md:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-[#5B2BA0] border border-white/20 shadow-lg shadow-[#5B2BA0]/40 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">{t.dashboard.title}</h1>
            <p className="text-xs md:text-sm text-white/65 mt-0.5">{organization?.name || t.dashboard.organization}</p>
          </div>
        </div>

        {/* Píldoras de cambio de sección con desenfoque suave (estilo Glassy Dashboard) */}
        <div className="glass-pill-bar p-1 rounded-full flex items-center gap-1 self-start sm:self-auto">
          {SECTIONS.map(sec => {
            const Icon = sec.icon;
            const active = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                onClick={() => setActiveSection(sec.id)}
                className={`relative px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  active ? 'text-[#5B2BA0]' : 'text-white/70 hover:text-white'
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="dashboardGlassTab"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    className="absolute inset-0 rounded-full bg-white shadow-md"
                  />
                )}
                <Icon className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">{sec.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Estado operativo (solo visible si la config está incompleta) */}
      <OperationalStatusCard />

      {/* KPI Grid — Tarjetas de vidrio esmerilado que se elevan al pasar el cursor */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
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
          subtitulo={costConfig?.tarifa_objetivo ? (locale === 'en' ? `target: $${costConfig.tarifa_objetivo.toFixed(2)}/mile` : `meta: $${costConfig.tarifa_objetivo.toFixed(2)}/milla`) : t.dashboard.target}
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

      {/* Transición de secciones con desenfoque suave (Blur + Fade) */}
      <AnimatePresence mode="wait">
        {activeSection === 'overview' && (
          <motion.div key="overview" {...SECTION_TRANSITION} className="space-y-5">
            {renderOperationalPanels()}
            <DashboardGoogleMap loads={recentLoads} trucks={trucks} locale={locale} />
            {renderRecentLoadsPanel()}
          </motion.div>
        )}

        {activeSection === 'operations' && (
          <motion.div key="operations" {...SECTION_TRANSITION} className="space-y-5">
            {renderOperationalPanels()}
            <DashboardGoogleMap loads={recentLoads} trucks={trucks} locale={locale} />
          </motion.div>
        )}

        {activeSection === 'loads' && (
          <motion.div key="loads" {...SECTION_TRANSITION} className="space-y-5">
            <DashboardGoogleMap loads={recentLoads} trucks={trucks} locale={locale} />
            {renderRecentLoadsPanel()}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
