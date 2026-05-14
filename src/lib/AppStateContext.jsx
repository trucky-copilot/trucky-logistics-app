import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { evaluateChecklist } from '@/lib/goLiveChecklist';

/**
 * App State Architecture  v2
 * ──────────────────────────
 * loading         → resolviendo estado
 * unauthenticated → no hay usuario autenticado
 * setup           → usuario autenticado, UserProfile.onboarding_completado === false
 * production      → onboarding completado — acceso total
 * demo            → workspace marcado explícitamente como demo (is_demo: true)
 *
 * Decisión de bloqueo: SOLO UserProfile.onboarding_completado.
 * CarrierProfile / CostConfig → avisos no bloqueantes (operationalReadiness).
 */

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const [appState, setAppState]                         = useState('loading');
  const [userProfile, setUserProfile]                   = useState(null);
  const [currentUser, setCurrentUser]                   = useState(null);
  const [organization, setOrganization]                 = useState(null);
  const [setupDetails, setSetupDetails]                 = useState(null);
  const [operationalReadiness, setOperationalReadiness] = useState(null);

  const resolveState = useCallback(async () => {
    setAppState('loading');
    try {
      const user = await base44.auth.me();

      if (!user) {
        setAppState('unauthenticated');
        return;
      }

      setCurrentUser(user);

      const result = await evaluateChecklist(user);
      setUserProfile(result.profile);
      setOrganization(result.organization);

      // Demo interno explícito — nunca se activa automáticamente
      if (result.profile?.is_demo) {
        setAppState('demo');
        return;
      }

      if (!result.ready) {
        // Usuario nuevo o sin onboarding — mostrar pantalla de setup
        setSetupDetails({ missing: ['onboarding'] });
        setOperationalReadiness(null);
        setAppState('setup');
        return;
      }

      // Acceso concedido — avisos no bloqueantes
      setSetupDetails(null);
      setOperationalReadiness({
        level:   result.operationalReadiness,
        missing: result.missingOptional,
      });
      setAppState('production');
    } catch {
      setAppState('unauthenticated');
    }
  }, []);

  useEffect(() => {
    resolveState();
  }, [resolveState]);

  return (
    <AppStateContext.Provider value={{
      appState,
      userProfile,
      currentUser,
      organization,
      organizationId: organization?.id || null,
      setupDetails,
      operationalReadiness,
      resolveState,
    }}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}

/** Shortcut hook — retorna el organization_id activo para filtrar queries */
export function useOrganizationId() {
  const { organizationId } = useAppState();
  return organizationId;
}