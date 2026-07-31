import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { AppStateProvider, useAppState } from '@/lib/AppStateContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Layout from '@/components/Layout';

// Page imports
import Welcome         from '@/pages/Welcome';
import Dashboard       from '@/pages/Dashboard';
import MarketChat      from '@/pages/MarketChat';
import DocumentAnalyzer from '@/pages/DocumentAnalyzer';
import Loads           from '@/pages/Loads';
import Fleet           from '@/pages/Fleet';
import Drivers         from '@/pages/Drivers';
import Brokers         from '@/pages/Brokers';
import CostCalculator  from '@/pages/CostCalculator';
import Notifications   from '@/pages/Notifications';
import Onboarding      from '@/pages/Onboarding';

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

// ─── Core app (reads AppStateContext) ─────────────────────────────────────────
function AppContent() {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const { appState, resolveState, setupDetails } = useAppState();

  // Platform-level loading / errors
  if (isLoadingPublicSettings || isLoadingAuth || appState === 'loading') return <AppLoading />;

  if (authError) {
    if (authError.type === 'user_not_registered') return <UserNotRegisteredError />;
    if (authError.type === 'auth_required') return <Welcome />;
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
        <Route path="/documentos"   element={<DocumentAnalyzer />} />
        <Route path="/cargas"       element={<Loads />} />
        <Route path="/flota"        element={<Fleet />} />
        <Route path="/conductores"  element={<Drivers />} />
        <Route path="/brokers"      element={<Brokers />} />
        <Route path="/calculadora"  element={<CostCalculator />} />
        <Route path="/notificaciones" element={<Notifications />} />
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
            <AppContent />
          </AppStateProvider>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;