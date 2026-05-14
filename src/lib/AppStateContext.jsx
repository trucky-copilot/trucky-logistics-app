import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * AppStateContext — v3 (simplificado)
 * ─────────────────────────────────────
 * Estados:
 *   loading         → resolviendo
 *   unauthenticated → sin usuario (manejado por AuthContext, pero por si acaso)
 *   setup           → usuario sin UserProfile.onboarding_completado === true
 *   production      → acceso total
 *
 * Regla de acceso: UNA sola query — UserProfile por email.
 * Si onboarding_completado === true → production.
 * Si no existe o es false → setup.
 * Sin queries a CarrierProfile, Organization ni GoLiveChecklist en esta capa.
 */

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const [appState, setAppState]                         = useState('loading');
  const [userProfile, setUserProfile]                   = useState(null);
  const [currentUser, setCurrentUser]                   = useState(null);
  const [organization, setOrganization]                 = useState(null);
  const [operationalReadiness, setOperationalReadiness] = useState(null);

  const resolveState = useCallback(async () => {
    setAppState('loading');
    try {
      // 1. Obtener usuario
      const user = await base44.auth.me();
      // 2. Sin usuario → unauthenticated
      if (!user) { setAppState('unauthenticated'); return; }
      setCurrentUser(user);

      // 3. Buscar UserProfile
      const profiles = await base44.entities.UserProfile.filter({ usuario: user.email });
      const profile  = profiles[0] || null;
      setUserProfile(profile);

      // 4. Sin perfil o sin onboarding → setup
      if (!profile || profile.onboarding_completado !== true) {
        setAppState('setup');
        return;
      }

      // 5. Onboarding completado → production
      // Cargar organización de forma no bloqueante
      base44.entities.OrganizationMember
        .filter({ user_email: user.email, active: true })
        .then(async (members) => {
          if (!members[0]?.organization_id) return;
          const orgs = await base44.entities.Organization.filter({ id: members[0].organization_id });
          setOrganization(orgs[0] || null);
        })
        .catch(() => {});

      // Operational readiness: no bloqueante
      loadOperationalReadiness(user.email, profile).then(setOperationalReadiness).catch(() => {});

      setAppState('production');
    } catch {
      setAppState('unauthenticated');
    }
  }, []);

  useEffect(() => { resolveState(); }, [resolveState]);

  return (
    <AppStateContext.Provider value={{
      appState,
      userProfile,
      currentUser,
      organization,
      organizationId: organization?.id || null,
      setupDetails:   null,   // ya no se usa — se eliminó GoLiveChecklistPanel del onboarding
      operationalReadiness,
      resolveState,
    }}>
      {children}
    </AppStateContext.Provider>
  );
}

/** Carga asíncrona de avisos no bloqueantes — nunca bloquea el acceso */
async function loadOperationalReadiness(email, profile) {
  const rol = profile?.rol;
  const needsCarrier    = rol === 'carrier'    || rol === 'ambos';
  const needsDispatcher = rol === 'dispatcher' || rol === 'ambos';

  const [costConfigs, dispProfiles] = await Promise.all([
    needsCarrier    ? base44.entities.CostConfig.filter({ usuario: email }) : Promise.resolve([]),
    needsDispatcher ? base44.entities.DispatcherProfile.filter({ user_id: email }) : Promise.resolve([]),
  ]);

  const missing = [];
  if (needsCarrier    && !(costConfigs[0]?.diesel_precio && costConfigs[0]?.mpg)) missing.push('cost_config');
  if (needsDispatcher && !dispProfiles[0]?.user_id) missing.push('dispatcher_profile');

  return {
    level:   missing.length === 0 ? 'ready' : missing.length === 1 ? 'partial' : 'basic',
    missing,
  };
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}

export function useOrganizationId() {
  return useAppState().organizationId;
}