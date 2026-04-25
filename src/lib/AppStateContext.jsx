import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * App State Architecture
 * ─────────────────────
 * SETUP      → Usuario autenticado pero sin onboarding completado
 * PRODUCTION → Usuario autenticado con onboarding completo y perfiles listos
 * DEMO       → Workspace marcado explícitamente como demo (is_demo: true en UserProfile)
 *
 * Regla crítica: Esta app (App Real) nunca carga seed data.
 * Los datos demo viven en una app de Base44 completamente separada.
 */

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const [appState, setAppState]       = useState('loading'); // 'loading' | 'setup' | 'production' | 'demo'
  const [userProfile, setUserProfile] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);

  const resolveState = useCallback(async () => {
    try {
      const user = await base44.auth.me();
      if (!user) { setAppState('setup'); return; }

      setCurrentUser(user);

      const profiles = await base44.entities.UserProfile.filter({ usuario: user.email });
      const profile  = profiles[0] || null;

      setUserProfile(profile);

      if (!profile || !profile.onboarding_completado) {
        setAppState('setup');
        return;
      }

      // Workspace marcado explícitamente como demo interno
      if (profile.is_demo) {
        setAppState('demo');
        return;
      }

      setAppState('production');
    } catch {
      setAppState('setup');
    }
  }, []);

  useEffect(() => {
    resolveState();
  }, [resolveState]);

  return (
    <AppStateContext.Provider value={{ appState, userProfile, currentUser, resolveState }}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}