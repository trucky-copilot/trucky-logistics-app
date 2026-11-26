import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard, MessageSquare, Mail, FileSearch, Calculator,
  Truck, Users, Package, Building2, Bell, Menu, X,
  LogOut, ChevronUp, ShieldAlert, Settings
} from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { isAppAdmin } from '@/lib/adminAccess';
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
import ProfileSelector from './ProfileSelector';
import DemoTour from './DemoTour';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { base44 } from '@/api/base44Client';
import { useEffectivePlan as useDemo } from '@/lib/LivePlanProvider';

const NAV_ITEMS = [
  { path: '/', label: 'dashboard', icon: LayoutDashboard },
  { path: '/chat', label: 'chat', icon: MessageSquare },
  { path: '/emails', label: 'emails', icon: Mail },
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
  const navigate = useNavigate();
  const { isDemoUser, limits, loading: planLoading } = useDemo();

  // Solo los administradores de src/lib/adminAccess.js ven el panel; las
  // cuentas de pruebas (luisbermudezacero@gmail.com, ianruizmora@gmail.com)
  // quedan como usuarios normales.
  const showAdminPanel = isAppAdmin(user);

  // Sin módulo de correo en el plan (demo): Emails se quita del menú.
  const visibleNavItems = NAV_ITEMS.filter((item) => item.path !== '/emails' || limits?.EMAIL_MODULE !== false);

  useEffect(() => {
    if (typeof window === 'undefined' || !user || !user.id) return;
    const createdDate = String(user.created_date || '');
    const createdDateUtc = /(?:Z|[+-]\d{2}:?\d{2})$/.test(createdDate)
      ? createdDate
      : createdDate + 'Z';
    const createdAtMs = Date.parse(createdDateUtc);
    const isNewSignup = Number.isFinite(createdAtMs) &&
      Date.now() - createdAtMs < 24 * 60 * 60 * 1000;
    const key = '_aw_signup_fired_AW-18531970204/FleXCPrCqaYdEJzZ3YRF_' + user.id;
    if (!isNewSignup || localStorage.getItem(key)) return;
    let tries = 0;
    const fire = () => {
      if (!window.gtag) { if (tries++ < 20) setTimeout(fire, 250); return; }
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
      window.gtag('event', 'conversion', {
        send_to: 'AW-18531970204/FleXCPrCqaYdEJzZ3YRF',
        transaction_id: user.id,
      });
    };
    fire();
  }, [user]);

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

  const correo = user?.email || '';
  const inicial = (correo.trim()[0] || 't').toUpperCase();

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const isChat = location.pathname.startsWith('/chat');

  // Clases de un ítem del menú (Figma · Sidebar/Nav Item: Default / Hover / Active).
  const navCls = (active, admin = false) => `
    flex items-center gap-3 h-12 px-4 rounded-full transition-colors duration-150
    ${active
      ? `bg-t-bg-canvas ${admin ? 'text-t-warning' : 'text-t-text-accent'} text-[15px] font-medium`
      : `${admin ? 'text-t-warning/80' : 'text-t-text-secondary'} text-sm hover:bg-t-action-secondary hover:text-t-text-primary`}
  `;

  return (
    <div className="flex h-screen h-[100dvh] bg-t-bg-deep overflow-hidden font-inter lg:p-3 lg:gap-3">
      {/* 100dvh: en el celular "h-screen" (100vh) es más alto que lo visible y la página se
          desplazaba, escondiendo la barra de arriba con el botón del menú. */}
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ background: 'var(--t-overlay)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar (Figma 8:150) */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 lg:z-auto
        w-[272px] flex-shrink-0 flex flex-col
        bg-t-bg-sidebar lg:rounded-[24px] shadow-card
        transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="flex items-center justify-between px-6 pt-7 pb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              role="img"
              aria-label="Trucky"
              className="h-9 w-[140px] bg-t-logo-fill flex-shrink-0"
              style={{
                WebkitMaskImage: 'url(/trucky-wordmark.png)', maskImage: 'url(/trucky-wordmark.png)',
                WebkitMaskSize: 'contain', maskSize: 'contain',
                WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'left center', maskPosition: 'left center',
              }}
            />
            {isDemoUser && (
              <span className="px-1.5 py-0.5 rounded-full bg-t-info-soft text-t-text-accent text-[10px] font-semibold uppercase tracking-[0.08em]">
                Demo
              </span>
            )}
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-t-text-muted hover:text-t-text-primary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto">
          {visibleNavItems.map(({ path, label, icon: Icon }) => {
            const active = isActive(path);
            return (
              <Link key={path} to={path} data-tour={path} onClick={() => setSidebarOpen(false)} className={navCls(active)}>
                <Icon className={`flex-shrink-0 ${active ? 'w-6 h-6' : 'w-5 h-5'}`} />
                <span className="flex-1 truncate">{t.nav[label]}</span>
              </Link>
            );
          })}
          {showAdminPanel && (
            <Link to="/admin" onClick={() => setSidebarOpen(false)} className={navCls(isActive('/admin'), true)}>
              <ShieldAlert className={`flex-shrink-0 ${isActive('/admin') ? 'w-6 h-6' : 'w-5 h-5'}`} />
              <span className="flex-1">Panel Admin</span>
            </Link>
          )}
        </nav>

        {/* Botón de Idioma */}
        <div className="px-4 pb-3">
          <ToggleGroup
            type="single"
            value={locale}
            onValueChange={(val) => {
              if (val) {
                setLocale(val);
                persistLocale(val);
              }
            }}
            className="justify-start bg-t-action-secondary p-1 rounded-full w-full"
          >
            <ToggleGroupItem value="es" size="sm" className="text-xs px-3 h-7 flex-1 rounded-full text-t-text-secondary data-[state=on]:bg-t-bg-canvas data-[state=on]:text-t-text-accent">ES</ToggleGroupItem>
            <ToggleGroupItem value="en" size="sm" className="text-xs px-3 h-7 flex-1 rounded-full text-t-text-secondary data-[state=on]:bg-t-bg-canvas data-[state=on]:text-t-text-accent">EN</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* Perfil (pie de la barra: Figma "Trucky · Your Road Co-Pilot") */}
        <div className="px-4 py-3 border-t border-t-border-default">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t.nav.openProfile}
              className="w-full flex items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-t-action-secondary focus:outline-none focus-visible:shadow-focus"
            >
              <div className="w-10 h-10 rounded-full bg-t-action-primary flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-white">{inicial}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-t-text-primary truncate">{t.nav.profile}</div>
                <div className="text-xs text-t-text-secondary truncate">
                  {correo || t.nav.activeSession}
                </div>
              </div>
              <ChevronUp className="w-4 h-4 text-t-text-muted flex-shrink-0" />
            </DropdownMenuTrigger>

            <DropdownMenuContent align="start" side="top" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="text-xs font-medium text-foreground">{t.nav.account}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {correo || t.nav.noEmail}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {/* F3-15: una sola opción "Configuración" que abre la página con todas las secciones. */}
              <DropdownMenuItem
                onSelect={() => { setSidebarOpen(false); navigate('/configuracion'); }}
                className="text-sm"
              >
                <Settings className="w-4 h-4 mr-2" />
                {locale === 'en' ? 'Settings' : 'Configuración'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => logout()} className="text-sm">
                <LogOut className="w-4 h-4 mr-2" />
                {t.nav.logout}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main content (Figma: bg/canvas, esquinas superiores de 24) */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-t-bg-canvas lg:rounded-t-[24px]">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 lg:px-8 h-16 flex-shrink-0 min-w-0 max-w-full">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-full text-t-text-muted hover:text-t-text-primary hover:bg-t-action-secondary"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="lg:hidden text-base font-semibold text-t-text-primary truncate">
            {t.nav[NAV_ITEMS.find(item => isActive(item.path))?.label] || 'Trucky'}
          </div>
          <div className="ml-auto flex items-center gap-3">
            {/* Las cuentas de administrador no manejan perfiles de empresa. */}
            {!showAdminPanel && <ProfileSelector />}
            <NotificationBell />
          </div>
        </header>

        {/* Market Ticker (Figma 8:248): franja bg/deep */}
        {!isChat && <MarketTicker />}

        {/* Operational readiness banner (no bloqueante) */}
        <OperationalReadinessBanner />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
          <Outlet />
        </main>
      </div>

      {/* Recorrido guiado del usuario Demo (calculadora → … → dashboard) */}
      <DemoTour
        user={user}
        locale={locale}
        isDemoUser={isDemoUser && !planLoading}
        visiblePaths={visibleNavItems.map((i) => i.path)}
        setSidebarOpen={setSidebarOpen}
      />
    </div>
  );
}
