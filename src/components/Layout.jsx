import { Outlet, Link, useLocation } from 'react-router-dom';
import { useState } from 'react';
import {
  LayoutDashboard, MessageSquare, FileSearch, Calculator,
  Truck, Users, Package, Building2, Bell, Menu, X, ChevronRight,
  LogOut, ChevronUp
} from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import NotificationBell from './NotificationBell';
import OperationalReadinessBanner from './OperationalReadinessBanner';
import MarketTicker from './MarketTicker';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { base44 } from '@/api/base44Client';
const NAV_ITEMS = [
  { path: '/', label: 'dashboard', icon: LayoutDashboard },
  { path: '/chat', label: 'chat', icon: MessageSquare },
  { path: '/documentos', label: 'documents', icon: FileSearch },
  { path: '/cargas', label: 'loads', icon: Package },
  { path: '/flota', label: 'fleet', icon: Truck },
  { path: '/conductores', label: 'drivers', icon: Users },
  { path: '/brokers', label: 'brokers', icon: Building2 },
  { path: '/calculadora', label: 'calculator', icon: Calculator },
  { path: '/notificaciones', label: 'notifications', icon: Bell },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();
  const { t, locale, setLocale } = useLanguage();

  const persistLocale = async (nextLocale) => {
    try {
      const user = await base44.auth.me();
      const existingProfiles = await base44.entities.UserProfile.filter({ usuario: user.email });
      if (existingProfiles.length > 0) {
        await base44.entities.UserProfile.update(existingProfiles[0].id, { idioma_chat: nextLocale });
      }
    } catch (err) {
      console.error('No se pudo persistir idioma', err);
    }
  };


  // El correo identifica la cuenta activa. Es lo único que se muestra: el nombre
  // de la empresa no se pone acá a propósito, para no repetir el problema de
  // mostrar identidad que no corresponde (F1-10).
  const correo = user?.email || '';
  const inicial = (correo.trim()[0] || 't').toLowerCase();

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const isChat = location.pathname.startsWith('/chat');

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
              <span className="flex-1">{t.nav[label]}</span>
              {isActive(path) && <ChevronRight className="w-3 h-3 text-primary opacity-60" />}
            </Link>
          ))}
        </nav>
        {/* --- NUEVO: Botón de Idioma --- */}
        <div className="px-4 pb-4">
          <ToggleGroup
            type="single"
            value={locale}
            onValueChange={(val) => {
              if (val) {
                setLocale(val);
                persistLocale(val);
              }
            }}
            className="justify-start bg-muted/20 p-1 rounded-lg w-full"
          >
            <ToggleGroupItem value="es" size="sm" className="text-xs px-3 h-7 flex-1">ES</ToggleGroupItem>
            <ToggleGroupItem value="en" size="sm" className="text-xs px-3 h-7 flex-1">EN</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {/* --- FIN NUEVO --- */}
        {/* Perfil — antes era branding estático... */}

        {/* Perfil — antes era branding estático; ahora abre el menú de la cuenta */}
        <div className="p-4 border-t border-border">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t.nav.openProfile}
              className="w-full flex items-center gap-2 rounded-lg p-1.5 -m-1.5 text-left transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-700 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-white">{inicial}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-foreground truncate">{t.nav.profile}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {correo || t.nav.activeSession}
                </div>
              </div>
              <ChevronUp className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            </DropdownMenuTrigger>

            <DropdownMenuContent align="start" side="top" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="text-xs font-medium text-foreground">{t.nav.account}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {correo || t.nav.noEmail}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => logout()} className="text-sm">
                <LogOut className="w-4 h-4 mr-2" />
                {t.nav.logout}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/50 backdrop-blur-sm flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="lg:hidden text-sm font-semibold text-foreground">
            {t.nav[NAV_ITEMS.find(item => isActive(item.path))?.label] || 'Trucky'}
          </div>
          {!isChat && <MarketTicker />}
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