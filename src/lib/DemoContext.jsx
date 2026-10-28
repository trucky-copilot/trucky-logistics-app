import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { useAppState } from './AppStateContext';
import { base44 } from '@/api/base44Client';

const DemoContext = createContext(null);

// Las cuentas de prueba ya no viven en el código: se administran en la lista
// TestAccount de la base de datos y aquí cada usuario solo lee su propio registro.

// Límites exactos definidos para cada plan
export const PLAN_LIMITS = {
  demo: {
    CHAT_MESSAGES: 15,
    FLEET: 3,
    BROKERS: 3,
    LOADS: 3,
    DRIVERS: 3,
    PROFILES: 3,
    DOCUMENTS_PER_MONTH: 3,
    ANALYZE_IN_CHAT: false,
    EMAIL_MODULE: false,
    name: 'Demo',
  },
  plan_29: {
    CHAT_MESSAGES: 1000,
    FLEET: 5,
    BROKERS: 5,
    LOADS: 5,
    DRIVERS: 5,
    PROFILES: 5,
    DOCUMENTS_PER_MONTH: 50,
    ANALYZE_IN_CHAT: false,
    EMAIL_MODULE: true,
    name: 'Plan $29 (Carrier)',
  },
  plan_99: {
    CHAT_MESSAGES: 2000,
    FLEET: 15,
    BROKERS: 15,
    LOADS: 15,
    DRIVERS: 15,
    PROFILES: 10,
    DOCUMENTS_PER_MONTH: Infinity,
    ANALYZE_IN_CHAT: true,
    EMAIL_MODULE: true,
    name: 'Plan $99 (Flota / Dispatcher)',
  },
  admin: {
    CHAT_MESSAGES: Infinity,
    FLEET: Infinity,
    BROKERS: Infinity,
    LOADS: Infinity,
    DRIVERS: Infinity,
    PROFILES: Infinity,
    DOCUMENTS_PER_MONTH: Infinity,
    ANALYZE_IN_CHAT: true,
    EMAIL_MODULE: true,
    name: 'Admin',
  },
};

export const DEMO_LIMITS = PLAN_LIMITS.demo;

export function DemoProvider({ children }) {
  const { user } = useAuth();
  const { currentUser, organization: appOrg } = useAppState();
  const [trialData, setTrialData] = useState(null);
  const [loadingTrial, setLoadingTrial] = useState(true);
  const [userOrg, setUserOrg] = useState(null);

  // Obtener email priorizando auth user y fallback a currentUser
  const userEmail = (user?.email || currentUser?.email || '').toLowerCase().trim();

  // ¿Esta cuenta está en la lista de cuentas de prueba? Se pregunta al servidor:
  // la lista no está en el código y solo devuelve el registro propio.
  const [isWhitelisted, setIsWhitelisted] = useState(false);
  const [loadingTestAccount, setLoadingTestAccount] = useState(true);

  useEffect(() => {
    let active = true;
    if (!userEmail) {
      setIsWhitelisted(false);
      setLoadingTestAccount(false);
      return;
    }
    setLoadingTestAccount(true);
    base44.entities.TestAccount.filter({ user_email: userEmail })
      .then((rows) => {
        if (!active) return;
        setIsWhitelisted(Array.isArray(rows) && rows.some((r) => r.active !== false));
      })
      .catch(() => {
        if (active) setIsWhitelisted(false);
      })
      .finally(() => {
        if (active) setLoadingTestAccount(false);
      });
    return () => { active = false; };
  }, [userEmail]);

  // Carga complementaria de Organización si appOrg no está disponible aún
  useEffect(() => {
    let isMounted = true;
    if (!userEmail) return;

    base44.entities.OrganizationMember.filter({ user_email: userEmail, active: true })
      .then(async (members) => {
        if (!isMounted || !members?.length) return;
        const orgIds = members.map(m => m.organization_id).filter(Boolean);
        const results = await Promise.all(orgIds.map(id => base44.entities.Organization.filter({ id })));
        const allOrgs = results.map(r => r?.[0]).filter(Boolean);
        const subscribedOrg = allOrgs.find(o => o.subscription_status === 'active' || o.subscription_status === 'trialing');
        if (isMounted && (subscribedOrg || allOrgs[0])) {
          setUserOrg(subscribedOrg || allOrgs[0]);
        }
      })
      .catch(() => {});

    return () => { isMounted = false; };
  }, [userEmail]);

  const activeOrg = appOrg || userOrg;

  // Resolución de Plan Activo
  const planType = useMemo(() => {
    if (isWhitelisted) return 'admin';
    const status = activeOrg?.subscription_status;
    const isSubscribed = status === 'active' || status === 'trialing';

    if (isSubscribed) {
      if (activeOrg?.plan_type === 'plan_99' || activeOrg?.account_type === 'dispatcher') return 'plan_99';
      return 'plan_29';
    }

    return 'demo';
  }, [isWhitelisted, activeOrg?.subscription_status, activeOrg?.plan_type, activeOrg?.account_type]);

  const isDemoUser = planType === 'demo';
  const isPlan29 = planType === 'plan_29';
  const isPlan99 = planType === 'plan_99';
  const isSubscribed = isPlan29 || isPlan99 || isWhitelisted;
  const currentLimits = PLAN_LIMITS[planType] || PLAN_LIMITS.demo;
  const canAnalyzeInChat = Boolean(currentLimits.ANALYZE_IN_CHAT);

  useEffect(() => {
    let isMounted = true;
    if (!userEmail) {
      setLoadingTrial(false);
      return;
    }

    // Esperar a saber si es cuenta de prueba antes de decidir el trial.
    if (loadingTestAccount) return;

    if (isWhitelisted || isSubscribed) {
      setTrialData({ isWhitelisted: true, isExpired: false });
      setLoadingTrial(false);
      return;
    }

    // Consultar estado de trial mediante la función segura de servidor
    const checkTrial = async () => {
      try {
        setLoadingTrial(true);

        let serverStatus = null;
        try {
          const res = await base44.functions.invoke('checkDemoTrialStatus');
          if (res?.data && !res.data.error) {
            serverStatus = res.data;
          }
        } catch (_) {}

        if (!isMounted) return;

        if (serverStatus) {
          setTrialData({
            hasTrial: Boolean(serverStatus.has_trial),
            isExpired: Boolean(serverStatus.is_expired),
            trialStartedAt: serverStatus.trial_started_at,
            trialEndsAt: serverStatus.trial_ends_at,
          });
          return;
        }

        // Fallback directo a la entidad DemoTrial
        let trials = [];
        const cleanEmail = userEmail.toLowerCase().trim();
        try {
          trials = await base44.entities.DemoTrial.filter({ user_email: cleanEmail });
          if (!trials || trials.length === 0) {
            const allTrials = await base44.entities.DemoTrial.list();
            trials = (allTrials || []).filter(item => 
              (item.user_email || '').toLowerCase().trim() === cleanEmail
            );
          }
        } catch (_) {}

        if (!isMounted) return;

        if (trials && trials.length > 0) {
          const t = trials[0];
          const endsAtMs = Date.parse(t.trial_ends_at);
          const isExpired = !isNaN(endsAtMs) && endsAtMs <= Date.now();
          setTrialData({
            hasTrial: true,
            isExpired,
            trialStartedAt: t.trial_started_at,
            trialEndsAt: t.trial_ends_at,
          });
        } else {
          setTrialData({
            hasTrial: false,
            isExpired: true,
          });
        }
      } catch (_) {
        if (!isMounted) return;
        setTrialData({ hasTrial: false, isExpired: true });
      } finally {
        if (isMounted) setLoadingTrial(false);
      }
    };

    checkTrial();
    return () => { isMounted = false; };
  }, [userEmail, isWhitelisted, isSubscribed, loadingTestAccount]);

  const isTrialExpired = isDemoUser && (trialData?.isExpired || !trialData?.hasTrial);

  const value = useMemo(() => ({
    planType,
    isDemoUser,
    isPlan29,
    isPlan99,
    isWhitelisted,
    isSubscribed,
    canAnalyzeInChat,
    trialData,
    loadingTrial: loadingTrial || loadingTestAccount,
    limits: currentLimits,
    planLimits: PLAN_LIMITS,
  }), [
    planType,
    isDemoUser,
    isPlan29,
    isPlan99,
    isWhitelisted,
    isSubscribed,
    canAnalyzeInChat,
    trialData,
    loadingTrial,
    loadingTestAccount,
    currentLimits,
  ]);

  return (
    <DemoContext.Provider value={value}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo() {
  const ctx = useContext(DemoContext);
  if (!ctx) {
    return {
      planType: 'demo',
      isDemoUser: true,
      isPlan29: false,
      isPlan99: false,
      isWhitelisted: false,
      isSubscribed: false,
      canAnalyzeInChat: false,
      trialData: null,
      loadingTrial: false,
      limits: PLAN_LIMITS.demo,
      planLimits: PLAN_LIMITS,
    };
  }
  return ctx;
}

export const usePlan = useDemo;