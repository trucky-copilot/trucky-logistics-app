import { Outlet, Link, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { 
  LayoutDashboard, MessageSquare, FileSearch, Calculator, 
  Truck, Users, Package, Building2, Bell, Menu, X, ChevronRight
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import NotificationBell from './NotificationBell';
import OperationalReadinessBanner from './OperationalReadinessBanner';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/chat', label: 'Chat de Mercado', icon: MessageSquare },
  { path: '/documentos', label: 'Verificador', icon: FileSearch },
  { path: '/cargas', label: 'Cargas', icon: Package },
  { path: '/flota', label: 'Flota', icon: Truck },
  { path: '/conductores', label: 'Conductores', icon: Users },
  { path: '/brokers', label: 'Brokers', icon: Building2 },
  { path: '/calculadora', label: 'Calculadora', icon: Calculator },
  { path: '/notificaciones', label: 'Notificaciones', icon: Bell },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden font-inter">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 lg:z-auto
        w-64 flex flex-col
        bg-card border-r border-border
        transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-violet-500 to-indigo-700 shadow-lg shadow-violet-500/20">
              <span className="text-white font-black text-lg leading-none">t</span>
            </div>
            <div className="leading-tight">
              <div className="text-base font-bold text-foreground tracking-tight lowercase">trucky</div>
              <div className="text-[10px] text-violet-300/70 font-medium">Your road co-pilot</div>
            </div>
          </div>
          <button 
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
            <Link
              key={path}
              to={path}
              onClick={() => setSidebarOpen(false)}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                transition-all duration-150 group
                ${isActive(path) 
                  ? 'bg-primary/15 text-primary border border-primary/20' 
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }
              `}
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${isActive(path) ? 'text-primary' : ''}`} />
              <span className="flex-1">{label}</span>
              {isActive(path) && <ChevronRight className="w-3 h-3 text-primary opacity-60" />}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-700 flex items-center justify-center">
              <span className="text-xs font-bold text-white">t</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-foreground truncate">trucky</div>
              <div className="text-[10px] text-violet-300/70">Your road co-pilot</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50 backdrop-blur-sm flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="lg:hidden text-sm font-semibold text-foreground">
            {NAV_ITEMS.find(item => isActive(item.path))?.label || 'Trucky'}
          </div>
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </header>

        {/* Operational readiness banner (no bloqueante) */}
        <OperationalReadinessBanner />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}