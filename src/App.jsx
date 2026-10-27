import BillingLinkConfirmation from "@/components/BillingLinkConfirmation";
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { LanguageProvider } from '@/lib/LanguageContext';
import { AppStateProvider, useAppState } from '@/lib/AppStateContext';
import { ProfileProvider } from '@/lib/ProfileContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Layout from '@/components/Layout';
import { DemoProvider, useDemo } from '@/lib/DemoContext';
import DemoExpiredScreen from '@/components/DemoExpiredScreen';

// Page imports
import Welcome         from '@/pages/Welcome';
import Dashboard       from '@/pages/Dashboard';
import MarketChat      from '@/pages/MarketChat';
import Emails          from '@/pages/Emails';
import DocumentAnalyzer from '@/pages/DocumentAnalyzer';
import Loads           from '@/pages/Loads';
import Fleet           from '@/pages/Fleet';
import Drivers         from '@/pages/Drivers';
import Brokers         from '@/pages/Brokers';
import CostCalculator  from '@/pages/CostCalculator';
import Notifications   from '@/pages/Notifications';
import Onboarding      from '@/pages/Onboarding';
import AdminDashboard  from '@/pages/admin/AdminDashboard';

if (typeof document !== 'undefined' && !window.__gads_loaded) {
  window.__gads_loaded = true;
  window.dataLayer = window.dataLayer || [];
  const inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
    if (inIframe) {
      try {
        const args = Array.prototype.slice.call(arguments);
        const cmd = args[0];
        window.parent.postMessage({
          type: 'base44_gtag_event',
          event: {
            source: 'gtag',
            timestamp: new Date().toLocaleTimeString(),
            command: cmd,
            params: args.slice(1),
            type: cmd === 'event' ? (args[1] || 'event') : cmd,
          },
        }, '*');
      } catch (_e) { /* relay must not break gtag */ }
    }
  };
  const s = document.createElement('script');
  s.src = 'https://www.googletagmanager.com/gtag/js?id=AW-18531970204';
  s.async = true;
  document.head.appendChild(s);
  window.gtag('js', new Date());
  window.gtag('config', 'AW-18531970204', { send_page_view: false });
}

// ─── Loading screen ───────────────────────────────────────────────────────────
function AppLoading() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-muted-foreground">Cargando Trucky...</p>
      </div>
    </div>
  );
}
// ─── Core app (reads AppStateContext & DemoContext) ──────────────────────────
function AppContent() {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const { appState, resolveState, setupDetails } = useAppState();
  const { isTrialExpired, loadingTrial, trialData } = useDemo();

  // Platform-level loading / errors
  if (isLoadingPublicSettings || isLoadingAuth || appState === 'loading' || loadingTrial) return <AppLoading />;

  if (authError) {
    if (authError.type === 'user_not_registered') return <UserNotRegisteredError />;
    if (authError.type === 'auth_required') return <Welcome />;
  }

  // ── SIN SESIÓN (TRUCKY-46) ─────────────────────────────────────────────────
  if (appState === 'unauthenticated') return <Welcome />;

  // ── CONTROL DE DEMO TRIAL ──────────────────────────────────────────────────
  if (isTrialExpired) {
    const reason = !trialData?.hasTrial ? 'no_trial' : 'expired';
    return <DemoExpiredScreen reason={reason} />;
  }

  // ── SETUP: user needs to complete onboarding ───────────────────────────────
  if (appState === 'setup') {
    return <Onboarding onComplete={resolveState} />;
  }

  // ── PRODUCTION (and edge-case DEMO internal) ───────────────────────────────
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/"             element={<Dashboard />} />
        <Route path="/chat"         element={<MarketChat />} />
        <Route path="/emails"       element={<Emails />} />
        <Route path="/documentos"   element={<DocumentAnalyzer />} />
        <Route path="/cargas"       element={<Loads />} />
        <Route path="/flota"        element={<Fleet />} />
        <Route path="/conductores"  element={<Drivers />} />
        <Route path="/brokers"      element={<Brokers />} />
        <Route path="/calculadora"  element={<CostCalculator />} />
        <Route path="/notificaciones" element={<Notifications />} />
        <Route path="/admin"        element={<AdminDashboard />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
        <AppStateProvider>
          <DemoProvider>
            <LanguageProvider>
              <ProfileProvider>
                <BillingLinkConfirmation />
                <AppContent />
              </ProfileProvider>
            </LanguageProvider>
          </DemoProvider>
        </AppStateProvider>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}


export default App;