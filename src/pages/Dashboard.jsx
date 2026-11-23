import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import {
  DollarSign, Truck, Package, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle2, Bell, Info, Zap, FileWarning, Building2, Users,
  ArrowUpRight, Layers, Activity, LayoutDashboard
} from 'lucide-react';
import { getOperationalAlerts } from '@/lib/operationalAlerts';
import KpiCard from '@/components/KpiCard';
import PageHeader from '@/components/PageHeader';
import StatusBadge from '@/components/StatusBadge';
import OperationalStatusCard from '@/components/OperationalStatusCard';
import DashboardGoogleMap from '@/components/DashboardGoogleMap';
import { Link } from 'react-router-dom';
import { useOrganizationId, useAppState } from '@/lib/AppStateContext';
import { useLanguage } from '@/lib/LanguageContext';
import { listByOrg } from '@/lib/orgScope';
import { useProfile } from '@/lib/ProfileContext';
import { effectiveRate, effectiveRpm, effectiveProfit } from '@/lib/loadRate';
import { Skeleton } from '@/components/ui/skeleton';

// "-$2,379" en vez de "$-2,379": Intl pone el signo antes del símbolo.
const fmtUSD = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

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
  const { organization, currentUser, organizationLoading } = useAppState();
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
    // No pedir datos hasta que la organización y el perfil estén resueltos.
    // Antes, con orgId = null, listByOrg devolvía [] al instante, loading pasaba
    // a false y se pintaban $0 / "My organization" como si fueran datos reales.
    if (organizationLoading || !activeProfileId) return;
    let cancelled = false;
    let retryTimer = null;
    // Límite de Base44 (429): esperar los segundos que indica "Retry after Xs".
    const esperaLimite = (err) => {
      const m = String(err?.message || err || '');
      if (!/rate limit|429/i.test(m)) return 0;
      return ((Number(m.match(/retry after\s*(\d+)/i)?.[1]) || 10) + 1) * 1000;
    };

    const cargar = async (intento = 0) => {
      // Si una consulta falla, se muestra lo demás (antes toda la pantalla quedaba en error).
      const results = await Promise.allSettled([
        listByOrg(base44.entities.Truck, orgId),
        listByOrg(base44.entities.Load, orgId, '-created_date', 50),
        listByOrg(base44.entities.Broker, orgId),
        listByOrg(base44.entities.Driver, orgId),
        listByOrg(base44.entities.Notification, orgId, '-created_date', 10),
        currentUser?.email ? base44.entities.CostConfig.filter({ usuario: currentUser.email }) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      const [rawTrucks, rawLoads, rawBrokers, rawDrivers, rawNotifs, configs] =
        results.map(r => (r.status === 'fulfilled' ? (r.value || []) : null));
      const fallos = results.filter(r => r.status === 'rejected').map(r => r.reason);

      // null = esa consulta falló: se conserva lo que ya había en pantalla
      if (rawTrucks) setTrucks(filterByProfile(rawTrucks, 'trucks'));
      if (rawLoads) setLoads(filterByProfile(rawLoads, 'loads'));
      if (rawBrokers) setBrokers(filterByProfile(rawBrokers, 'brokers'));
      if (rawDrivers) setDrivers(filterByProfile(rawDrivers, 'drivers'));
      if (rawNotifs) {
        const notifIds = getProfileIds('notifs') || [];
        setNotifications(rawNotifs.filter(n => {
          if (n.profile_id) return n.profile_id === activeProfileId;
          if (activeProfileId === '1' && notifIds.length === 0) return true;
          return notifIds.includes(n.id);
        }));
      }
      if (configs) setCostConfig(configs.length > 0 ? configs[0] : null);

      if (fallos.length === 0) { setError(null); setLoading(false); return; }
      console.error('Dashboard: error al cargar datos', fallos);
      const espera = Math.max(0, ...fallos.map(esperaLimite));
      if (espera > 0 && intento < 3) {
        // Límite de consultas: reintentar solo (máximo 3 veces).
        retryTimer = setTimeout(() => { if (!cancelled) cargar(intento + 1); }, espera);
        if (fallos.length === results.length) return; // sigue cargando hasta el reintento
      } else if (fallos.length === results.length) {
        setError(t.dashboard.error);
      }
      setLoading(false);
    };

    setLoading(true);
    setError(null);
    cargar().catch((err) => {
      if (cancelled) return;
      console.error('Dashboard: error al cargar datos', err);
      setError(t.dashboard.error);
      setLoading(false);
    });
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  }, [orgId, activeProfileId, organizationLoading, currentUser?.email]);

  // ── Cálculos intactos de KPIs ────────────────────────────────────────────────
  const thisWeek = loads.filter(l => {
    const d = new Date(l.created_date);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return d >= weekAgo;
  });

  // Tarifa efectiva: negociada o, si falta, la ofrecida (QA)
  const totalRevenue = thisWeek.reduce((s, l) => s + effectiveRate(l), 0);
  const totalProfit = thisWeek.reduce((s, l) => s + effectiveProfit(l), 0);
  const totalMilesThisWeek = thisWeek.reduce((s, l) => s + (l.millas || 0), 0);
  const avgRatePerMile = totalMilesThisWeek > 0 ? totalRevenue / totalMilesThisWeek : 0;

  // Semana anterior (hace 7–14 días) para calcular la variación de la ganancia.
  // Ojo: se calcula sobre las últimas 50 cargas que trae la consulta.
  const prevWeek = loads.filter(l => {
    const d = new Date(l.created_date);
    const now = Date.now();
    return d >= new Date(now - 14 * 864e5) && d < new Date(now - 7 * 864e5);
  });
  const prevProfit = prevWeek.reduce((s, l) => s + effectiveProfit(l), 0);
  const prevRevenue = prevWeek.reduce((s, l) => s + effectiveRate(l), 0);
  const prevMiles = prevWeek.reduce((s, l) => s + (l.millas || 0), 0);
  const prevAvgRate = prevMiles > 0 ? prevRevenue / prevMiles : 0;

  // Variación vs semana anterior para TODAS las tarjetas (QA: flecha según la variación).
  // trend > 0 → flecha arriba (verde), < 0 → abajo (rojo), 0 → sin cambio.
  const vsLabel = isEs ? 'vs semana anterior' : 'vs last week';
  const sign = (d) => (d > 0 ? '+' : d < 0 ? '−' : '');
  const trendOf = (delta, format) => ({
    trend: delta,
    trendLabel: `${sign(delta)}${format(Math.abs(delta))} ${vsLabel}`,
  });
  const profitDelta = totalProfit - prevProfit;
  const profitTrend = trendOf(profitDelta, fmtUSD);
  const revenueTrend = trendOf(totalRevenue - prevRevenue, fmtUSD);
  const tripsTrend = trendOf(thisWeek.length - prevWeek.length, (n) => String(n));
  // La tarifa por milla solo se compara si ambas semanas tienen millas
  const rateTrend = avgRatePerMile > 0 && prevAvgRate > 0
    ? trendOf(Number((avgRatePerMile - prevAvgRate).toFixed(2)), (n) => `$${n.toFixed(2)}/mi`)
    : { trend: 0, trendLabel: isEs ? 'Sin datos para comparar' : 'No data to compare' };

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

  // Skeleton con la misma forma que el dashboard real: el usuario ve que algo
  // está cargando, sin números falsos y sin "salto" de layout al llegar los datos.
  if (loading) return (
    <div className="t-page space-y-6" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-3.5">
        <div className="space-y-2">
          <Skeleton className="h-6 w-56 bg-foreground/10" />
          <Skeleton className="h-3.5 w-32 bg-foreground/10" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="t-surface-card p-5 rounded-2xl space-y-3">
            <div className="flex items-start justify-between">
              <Skeleton className="h-3 w-24 bg-foreground/10" />
              <Skeleton className="w-9 h-9 rounded-xl bg-foreground/10" />
            </div>
            <Skeleton className="h-7 w-20 bg-foreground/10" />
            <Skeleton className="h-3 w-28 bg-foreground/10" />
          </div>
        ))}
      </div>
      <span className="sr-only">{isEs ? 'Cargando datos…' : 'Loading data…'}</span>
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
      <AlertTriangle className="w-8 h-8 text-t-danger" />
      <p className="text-sm text-foreground font-medium">{error}</p>
    </div>
  );

  const renderOperationalPanels = () => (
    <div className="grid lg:grid-cols-3 gap-4">
      {/* Fleet Status */}
      <motion.div
        className="t-surface rounded-2xl p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-t-bg-surface-raised flex items-center justify-center">
              <Truck className="w-5 h-5 text-t-text-accent" />
            </div>
            <h2 className="text-base font-semibold text-t-text-primary">{t.dashboard.fleetStatus}</h2>
          </div>
          <Link to="/flota" className="text-xs text-t-text-accent hover:text-foreground flex items-center gap-0.5 transition-colors">
            {t.dashboard.viewAll}
            <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        {trucks.length === 0 ? (
          <div className="text-center py-8 text-foreground/55 text-sm">{t.dashboard.noTrucks}</div>
        ) : (
          <div className="space-y-2">
            {trucks.slice(0, 6).map(truck => (
              <div
                key={truck.id}
                className="flex items-center justify-between py-2 px-2.5 rounded-xl bg-foreground/[0.03] hover:bg-foreground/[0.07] border border-t-border-subtle transition-colors"
              >
                <div>
                  <div className="text-sm font-medium text-foreground">{truck.placa}</div>
                  <div className="text-xs text-foreground/60">{truck.conductor_nombre || t.dashboard.noDriver}</div>
                </div>
                <StatusBadge status={truck.estado} />
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Document Alerts and Notifications */}
      <motion.div
        className={`t-surface rounded-2xl p-5 relative overflow-hidden ${
          hasCriticalAlerts
            ? 'border-red-400/35 shadow-red-950/30'
            : hasWarningAlerts
            ? 'border-amber-400/35 shadow-amber-950/30'
            : ''
        }`}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-sm font-semibold ${hasCriticalAlerts ? 'text-t-danger' : hasWarningAlerts ? 'text-t-warning' : 'text-foreground'}`}>
            {hasCriticalAlerts
              ? `🔴 ${t.dashboard.alertsAndNotifications}`
              : hasWarningAlerts
              ? `🟡 ${t.dashboard.alertsAndNotifications}`
              : t.dashboard.alertsAndNotifications}
          </h2>
          <Link to="/notificaciones" className="text-xs text-t-text-accent hover:text-foreground flex items-center gap-0.5 transition-colors">
            {t.dashboard.viewAll}
            <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        {operationalAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center mb-2.5">
              <CheckCircle2 className="w-6 h-6 text-t-success" />
            </div>
            <p className="text-sm text-foreground/70">{t.dashboard.allInOrder}</p>
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
                  className={`flex items-start gap-3 p-3 rounded-xl border-l-4 border transition-all hover:translate-x-0.5 ${
                    isRed
                      ? 'border-l-t-danger bg-t-danger-soft border-border hover:border-t-border-strong'
                      : 'border-l-t-warning bg-t-warning-soft border-border hover:border-t-border-strong'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isRed ? 'bg-red-400/20' : 'bg-amber-400/20'
                  }`}>
                    <IconComponent className={`w-4 h-4 ${isRed ? 'text-t-danger' : 'text-t-warning'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1.5">
                      <p className="text-xs font-semibold text-foreground truncate">{alert.titulo}</p>
                      <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0 ${
                        isRed ? 'text-t-danger bg-red-400/15' : 'text-t-warning bg-amber-400/15'
                      }`}>
                        {alert.moduloLabel || alert.modulo}
                      </span>
                    </div>
                    <p className={`text-xs mt-0.5 ${isRed ? 'text-t-danger' : 'text-t-warning/90'}`}>
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
        className="t-surface rounded-2xl p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-t-bg-surface-raised flex items-center justify-center">
              <Building2 className="w-5 h-5 text-t-text-accent" />
            </div>
            <h2 className="text-base font-semibold text-t-text-primary">{t.dashboard.topBrokers}</h2>
          </div>
          <Link to="/brokers" className="text-xs text-t-text-accent hover:text-foreground flex items-center gap-0.5 transition-colors">
            {t.dashboard.viewAll}
            <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        {brokers.length === 0 ? (
          <div className="text-center py-8 text-foreground/55 text-sm">{t.dashboard.noBrokers}</div>
        ) : (
          <div className="space-y-2">
            {brokers.slice(0, 5).map((b, i) => (
              <div
                key={b.id}
                className="flex items-center gap-2.5 py-2 px-2.5 rounded-xl bg-foreground/[0.03] hover:bg-foreground/[0.07] border border-t-border-subtle transition-colors"
              >
                <span className="text-xs font-bold text-t-text-accent w-5 h-5 rounded-md bg-t-action-primary/40 border border-border flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate" title={b.nombre}>{b.nombre}</div>
                  <div className="text-xs text-foreground/60">{b.cargas_realizadas || 0} {t.dashboard.loads}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-mono font-medium text-foreground">${b.tarifa_promedio?.toFixed(2) || '--'}/mi</div>
                  <div className={`text-xs font-medium ${(b.puntaje_confiabilidad || 0) >= 7 ? 'text-t-success' : (b.puntaje_confiabilidad || 0) >= 5 ? 'text-t-warning' : 'text-t-danger'}`}>
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
      className="t-surface rounded-2xl p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-t-bg-surface-raised flex items-center justify-center">
            <Package className="w-5 h-5 text-t-text-accent" />
          </div>
          <h2 className="text-base font-semibold text-t-text-primary">{t.dashboard.recentLoads}</h2>
        </div>
        <Link to="/cargas" className="text-xs text-t-text-accent hover:text-foreground flex items-center gap-0.5 transition-colors">
          {t.dashboard.viewAllLoads}
          <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>
      {recentLoads.length === 0 ? (
        <div className="text-center py-8 text-foreground/55 text-sm">{t.dashboard.noLoads}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="t-overline border-b border-border">
                <th className="text-left py-2.5 px-3 font-medium rounded-tl-lg">{t.dashboard.route}</th>
                <th className="text-left py-2.5 px-3 font-medium hidden sm:table-cell">{t.dashboard.broker}</th>
                <th className="text-right py-2.5 px-3 font-medium hidden md:table-cell">{t.dashboard.miles}</th>
                <th className="text-right py-2.5 px-3 font-medium">$/mi</th>
                <th className="text-right py-2.5 px-3 font-medium rounded-tr-lg">{t.dashboard.total}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-t-border-subtle">
              {recentLoads.map(load => (
                <tr key={load.id} className="hover:bg-foreground/[0.06] transition-colors">
                  <td className="py-2.5 px-3 text-foreground">
                    <div className="font-medium text-xs">{load.origen}</div>
                    <div className="text-foreground/60 text-xs">→ {load.destino}</div>
                  </td>
                  <td className="py-2.5 px-3 text-foreground/70 hidden sm:table-cell text-xs max-w-[10rem] truncate" title={load.broker_nombre || ''}>{load.broker_nombre || '--'}</td>
                  <td className="py-2.5 px-3 text-right text-foreground/70 hidden md:table-cell text-xs font-mono">{load.millas || '--'}</td>
                  <td className={`py-2.5 px-3 text-right font-mono text-xs font-medium ${
                    effectiveRpm(load) >= 3 ? 'text-t-success' :
                    effectiveRpm(load) >= 2.6 ? 'text-t-warning' : 'text-t-danger'
                  }`}>{effectiveRpm(load) > 0 ? `$${effectiveRpm(load).toFixed(2)}` : '--'}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs font-semibold text-foreground">${effectiveRate(load).toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );

  return (
    <div className="t-page space-y-6 w-full max-w-full min-w-0 overflow-x-hidden">
      <PageHeader icon={LayoutDashboard} title={t.dashboard.title} subtitle={organization?.name || t.dashboard.organization}>
        {/* Píldoras de cambio de sección con desenfoque suave (estilo Glassy Dashboard) */}
        <div className="bg-t-action-secondary p-1 rounded-full flex items-center gap-1 self-start overflow-x-auto max-w-full">
          {SECTIONS.map(sec => {
            const Icon = sec.icon;
            const active = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                onClick={() => setActiveSection(sec.id)}
                className={`relative h-9 px-4 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  active ? 'text-t-text-accent' : 'text-t-text-secondary hover:text-t-text-primary'
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="dashboardGlassTab"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    className="absolute inset-0 rounded-full bg-t-bg-canvas"
                  />
                )}
                <Icon className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">{sec.label}</span>
              </button>
            );
          })}
        </div>
      </PageHeader>

      {/* Estado operativo (solo visible si la config está incompleta) */}
      <OperationalStatusCard />

      {/* KPI Grid — Tarjetas de vidrio esmerilado que se elevan al pasar el cursor */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          titulo={t.dashboard.weeklyRevenue}
          valor={fmtUSD(totalRevenue)}
          subtitulo={`${thisWeek.length} ${thisWeek.length === 1 ? t.dashboard.load : t.dashboard.loads}`}
          icon={DollarSign}
          trend={revenueTrend.trend}
          trendLabel={revenueTrend.trendLabel}
          color="cyan"
        />
        <KpiCard
          titulo={t.dashboard.netProfit}
          valor={fmtUSD(totalProfit)}
          subtitulo={t.dashboard.estimatedThisWeek}
          icon={totalProfit < 0 ? TrendingDown : TrendingUp}
          trend={profitTrend.trend}
          trendLabel={profitTrend.trendLabel}
          color={totalProfit >= 0 ? 'green' : 'red'}
        />
        <KpiCard
          titulo={t.dashboard.averageRate}
          valor={avgRatePerMile > 0 ? `$${avgRatePerMile.toFixed(2)}` : '--'}
          subtitulo={costConfig?.tarifa_objetivo ? (locale === 'en' ? `target: $${costConfig.tarifa_objetivo.toFixed(2)}/mile` : `meta: $${costConfig.tarifa_objetivo.toFixed(2)}/milla`) : t.dashboard.target}
          icon={Package}
          trend={rateTrend.trend}
          trendLabel={rateTrend.trendLabel}
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
          trend={tripsTrend.trend}
          trendLabel={tripsTrend.trendLabel}
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
