import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
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

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

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