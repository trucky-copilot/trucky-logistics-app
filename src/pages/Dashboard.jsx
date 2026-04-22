import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { DollarSign, Truck, Package, TrendingUp, AlertTriangle, CheckCircle2, XCircle, Clock } from 'lucide-react';
import KpiCard from '@/components/KpiCard';
import StatusBadge from '@/components/StatusBadge';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const [trucks, setTrucks] = useState([]);
  const [loads, setLoads] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      base44.entities.Truck.list(),
      base44.entities.Load.list('-created_date', 50),
      base44.entities.Broker.list(),
      base44.entities.Driver.list(),
    ]).then(([t, l, b, d]) => {
      setTrucks(t);
      setLoads(l);
      setBrokers(b);
      setDrivers(d);
      setLoading(false);
    });
  }, []);

  // KPI calculations
  const thisWeek = loads.filter(l => {
    const d = new Date(l.created_date);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return d >= weekAgo;
  });

  const totalRevenue = thisWeek.reduce((s, l) => s + (l.tarifa_negociada || 0), 0);
  const totalProfit = thisWeek.reduce((s, l) => s + (l.ganancia_estimada || 0), 0);
  const avgRatePerMile = thisWeek.length > 0
    ? thisWeek.reduce((s, l) => s + (l.revenue_por_milla || 0), 0) / thisWeek.filter(l => l.revenue_por_milla).length
    : 0;
  // Expiring documents
  const today = new Date();
  const sevenDays = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const thirtyDays = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiringDocs = drivers.flatMap(d => {
    const alerts = [];
    const fields = [
      { key: 'licencia_vencimiento', label: 'Licencia' },
      { key: 'medico_vencimiento', label: 'Médico' },
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

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Dashboard Operacional</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Larcofer USA — Miami, FL</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          titulo="Facturación Semana"
          valor={`$${totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          subtitulo={`${thisWeek.length} cargas`}
          icon={DollarSign}
          color="cyan"
        />
        <KpiCard
          titulo="Ganancia Neta"
          valor={`$${totalProfit.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          subtitulo="estimado esta semana"
          icon={TrendingUp}
          color={totalProfit >= 0 ? 'green' : 'red'}
        />
        <KpiCard
          titulo="Tarifa Promedio/Milla"
          valor={avgRatePerMile > 0 ? `$${avgRatePerMile.toFixed(2)}` : '--'}
          subtitulo="meta: $3.00/milla"
          icon={Package}
          color={avgRatePerMile >= 3 ? 'green' : avgRatePerMile >= 2.6 ? 'yellow' : 'red'}
        />
        <KpiCard
          titulo="Viajes Esta Semana"
          valor={thisWeek.length}
          subtitulo={`${loads.filter(l => l.estado === 'en_transito').length} en tránsito ahora`}
          icon={Truck}
          color="cyan"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Fleet Status */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Estado de la Flota</h2>
            <Link to="/flota" className="text-xs text-primary hover:underline">Ver todo</Link>
          </div>
          {trucks.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">No hay camiones registrados</div>
          ) : (
            <div className="space-y-2">
              {trucks.slice(0, 6).map(truck => (
                <div key={truck.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                  <div>
                    <div className="text-sm font-medium text-foreground">{truck.placa}</div>
                    <div className="text-xs text-muted-foreground">{truck.conductor_nombre || 'Sin conductor'}</div>
                  </div>
                  <StatusBadge status={truck.estado} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Document Alerts */}
        <div className={`rounded-xl p-4 border ${expiringDocs.some(a => a.urgent || a.expired) ? 'bg-red-400/5 border-red-400/30' : 'bg-card border-border'}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className={`text-sm font-semibold ${expiringDocs.some(a => a.urgent || a.expired) ? 'text-red-400' : 'text-foreground'}`}>
              {expiringDocs.some(a => a.urgent || a.expired) ? '🔴 Alertas de Documentos' : 'Alertas de Documentos'}
            </h2>
            <span className="text-xs text-muted-foreground">próx. 30 días</span>
          </div>
          {expiringDocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <CheckCircle2 className="w-8 h-8 text-green-400 mb-2" />
              <p className="text-sm text-muted-foreground">Todos los documentos en orden</p>
            </div>
          ) : (
            <div className="space-y-2">
              {expiringDocs.map((alert, i) => (
                <div key={i} className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${alert.expired || alert.urgent ? 'bg-red-400/10 border-red-400/30' : 'bg-yellow-400/5 border-yellow-400/20'}`}>
                  {alert.expired
                    ? <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                    : alert.urgent
                    ? <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                    : <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                  }
                  <div>
                    <p className="text-xs font-semibold text-foreground">{alert.driver}</p>
                    <p className="text-xs text-muted-foreground">{alert.doc} — {alert.expired ? '🔴 VENCIDO' : alert.urgent ? `🔴 Vence: ${alert.date}` : `⚠ Vence: ${alert.date}`}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Broker Scoreboard */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Top Brokers</h2>
            <Link to="/brokers" className="text-xs text-primary hover:underline">Ver todo</Link>
          </div>
          {brokers.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">No hay brokers registrados</div>
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
          <h2 className="text-sm font-semibold text-foreground">Cargas Recientes</h2>
          <Link to="/cargas" className="text-xs text-primary hover:underline">Ver todas</Link>
        </div>
        {recentLoads.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">No hay cargas registradas aún</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left pb-2 font-medium">Ruta</th>
                  <th className="text-left pb-2 font-medium hidden sm:table-cell">Broker</th>
                  <th className="text-right pb-2 font-medium hidden md:table-cell">Millas</th>
                  <th className="text-right pb-2 font-medium">$/mi</th>
                  <th className="text-right pb-2 font-medium">Total</th>
                  <th className="text-right pb-2 font-medium hidden sm:table-cell">Resultado</th>
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