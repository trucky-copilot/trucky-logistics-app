import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * App State Architecture
 * ─────────────────────
 * unauthenticated → No hay usuario autenticado
 * setup           → Usuario autenticado pero workspace incompleto
 * production      → Todas las condiciones cumplidas — listo para operar
 * demo            → Workspace marcado explícitamente como demo (is_demo: true)
 *
 * Regla crítica: Esta app nunca carga seed data.
 * Los datos demo viven en una app de Base44 completamente separada.
 */

const AppStateContext = createContext(null);

/**
 * Evalúa si el workspace está listo para producción.
 * Retorna { ready: bool, missing: string[] }
 */
async function evaluateWorkspace(user) {
  const email = user.email;

  // Cargar todo en paralelo
  const [profiles, members, costConfigs, carrierProfiles, dispatcherProfiles] = await Promise.all([
    base44.entities.UserProfile.filter({ usuario: email }),
    base44.entities.OrganizationMember.filter({ user_email: email, active: true }),
    base44.entities.CostConfig.filter({ usuario: email }),
    base44.entities.CarrierProfile.filter({ active: true }),
    base44.entities.DispatcherProfile.filter({ user_id: email }),
  ]);

  const profile         = profiles[0]          || null;
  const membership      = members[0]           || null;
  const costConfig      = costConfigs[0]        || null;
  const carrierProfile  = carrierProfiles[0]   || null;
  const dispProfile     = dispatcherProfiles[0] || null;

  // Resolver organización activa
  let organization = null;
  if (membership?.organization_id) {
    const orgs = await base44.entities.Organization.filter({ id: membership.organization_id });
    organization = orgs[0] || null;
  }

  const missing = [];

  // 1. Organización activa
  if (!organization?.active) missing.push('organization');

  // 2. Rol definido
  if (!profile?.rol) missing.push('rol');

  // 3. Onboarding completado
  if (!profile?.onboarding_completado) missing.push('onboarding');

  // 4. Perfil de rol requerido
  if (profile?.rol === 'carrier' || profile?.rol === 'ambos') {
    if (!carrierProfile?.company_name || !carrierProfile?.mc_number) {
      missing.push('carrier_profile');
    }
  }
  if (profile?.rol === 'dispatcher' || profile?.rol === 'ambos') {
    if (!dispProfile?.user_id) {
      missing.push('dispatcher_profile');
    }
  }

  // 5. CostConfig válida (requerida si es carrier o ambos)
  if (profile?.rol === 'carrier' || profile?.rol === 'ambos') {
    if (!costConfig || !costConfig.diesel_precio || !costConfig.mpg) {
      missing.push('cost_config');
    }
  }

  // 6. Workspace marcado como production_ready en la organización
  if (organization && !organization.production_ready) missing.push('production_ready');

  return {
    profile,
    organization,
    membership,
    carrierProfile,
    dispProfile,
    costConfig,
    missing,
    ready: missing.length === 0,
  };
}

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

      const workspace = await evaluateWorkspace(user);
      setUserProfile(workspace.profile);
      setOrganization(workspace.organization);

      // Demo interno explícito
      if (workspace.profile?.is_demo) {
        setAppState('demo');
        return;
      }

      if (!workspace.ready) {
        setSetupDetails({ missing: workspace.missing });
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