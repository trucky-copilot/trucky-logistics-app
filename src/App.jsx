import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Layout from '@/components/Layout';

// Page imports
import Dashboard from '@/pages/Dashboard';
import MarketChat from '@/pages/MarketChat';
import DocumentAnalyzer from '@/pages/DocumentAnalyzer';
import Loads from '@/pages/Loads';
import Fleet from '@/pages/Fleet';
import Drivers from '@/pages/Drivers';
import Brokers from '@/pages/Brokers';
import CostCalculator from '@/pages/CostCalculator';
import Notifications from '@/pages/Notifications';
import Onboarding from '@/pages/Onboarding';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  useEffect(() => {
    const checkOnboarding = async () => {
      try {
        const user = await base44.auth.me();
        if (!user) return;
        const profiles = await base44.entities.UserProfile.filter({ usuario: user.email });
        if (profiles.length === 0) {
          setShowOnboarding(true);
        }
      } catch {}
      setOnboardingChecked(true);
    };
    checkOnboarding();
  }, [isLoadingAuth]);

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-muted-foreground">Cargando Trucky...</p>
        </div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  if (showOnboarding && onboardingChecked) {
    return <Onboarding onComplete={() => setShowOnboarding(false)} />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/chat" element={<MarketChat />} />
        <Route path="/documentos" element={<DocumentAnalyzer />} />
        <Route path="/cargas" element={<Loads />} />
        <Route path="/flota" element={<Fleet />} />
        <Route path="/conductores" element={<Drivers />} />
        <Route path="/brokers" element={<Brokers />} />
        <Route path="/calculadora" element={<CostCalculator />} />
        <Route path="/notificaciones" element={<Notifications />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App