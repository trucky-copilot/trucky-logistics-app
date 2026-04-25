import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { evaluateAndPersistChecklist } from '@/lib/goLiveChecklist';

/**
 * App State Architecture
 * ─────────────────────
 * unauthenticated → No hay usuario autenticado
 * setup           → Usuario autenticado pero workspace incompleto (overall_status != ready_for_production)
 * production      → overall_status === ready_for_production
 * demo            → Workspace marcado explícitamente como demo (is_demo: true)
 *
 * Regla crítica: Esta app nunca carga seed data.
 * Los datos demo viven en una app de Base44 completamente separada.
 */

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const [appState, setAppState]           = useState('loading');
  const [userProfile, setUserProfile]     = useState(null);
  const [currentUser, setCurrentUser]     = useState(null);
  const [organization, setOrganization]   = useState(null);
  const [setupDetails, setSetupDetails]   = useState(null); // { missing: [] }

  const resolveState = useCallback(async () => {
    setAppState('loading');
    try {
      const user = await base44.auth.me();

      if (!user) {
        setAppState('unauthenticated');
        return;
      }

      setCurrentUser(user);

      // GoLiveChecklist es la fuente de verdad para el estado del workspace
      const result = await evaluateAndPersistChecklist(user);
      setUserProfile(result.profile);
      setOrganization(result.organization);

      // Demo interno explícito
      if (result.profile?.is_demo) {
        setAppState('demo');
        return;
      }

      if (!result.ready) {
        setSetupDetails({ missing: result.missing, overall_status: result.overall_status, checklist: result.checklist });
        setAppState('setup');
        return;
      }

      setSetupDetails(null);
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
      organization,           // organización activa del usuario
      organizationId: organization?.id || null,  // shortcut para filtrar queries
      setupDetails,           // { missing: string[] } — disponible en setup para mostrar qué falta
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