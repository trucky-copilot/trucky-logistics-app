import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { useAppState } from './AppStateContext';
import { base44 } from '@/api/base44Client';

const DemoContext = createContext(null);

// Correos administradores / exceptuados de restricciones y expiración demo
export const WHITELISTED_ADMIN_EMAILS = new Set([
  'daniel.vargas@ogm.com.co',
  'luisbermudezacero@gmail.com',
  'juan.grau@ogm.com.co',
  'luis.bermudez@ogm.com.co',
]);

// Límites definidos para usuarios demo
export const DEMO_LIMITS = {
  CHAT_MESSAGES: 15,
  PROFILES: 3,
  BROKERS: 3,
  DRIVERS: 3,
  FLEET: 3,
  LOADS: 3,
  DOCUMENTS: 3,
};

export function DemoProvider({ children }) {
  const { user } = useAuth();
  const { currentUser } = useAppState();
  const [trialData, setTrialData] = useState(null);
  const [loadingTrial, setLoadingTrial] = useState(true);

  // Obtener email priorizando auth user y fallback a currentUser
  const userEmail = (user?.email || currentUser?.email || '').toLowerCase().trim();
  const isWhitelisted = WHITELISTED_ADMIN_EMAILS.has(userEmail);

  useEffect(() => {
    let isMounted = true;
    if (!userEmail) {
      setLoadingTrial(false);
      return;
    }

    if (isWhitelisted) {
      setTrialData({ isWhitelisted: true, isExpired: false });
      setLoadingTrial(false);
      return;
    }

    // Consultar estado de trial mediante la función segura de servidor
    const checkTrial = async () => {
      try {
        setLoadingTrial(true);

        // 1. Intentar validar mediante la función de servidor checkDemoTrialStatus
        console.log('[DemoContext] Checking demo trial status for:', userEmail);

        let serverStatus = null;
        try {
          const res = await base44.functions.invoke('checkDemoTrialStatus');
          if (res?.data && !res.data.error) {
            serverStatus = res.data;
          }
        } catch (fnErr) {
          console.warn('[DemoContext] checkDemoTrialStatus invocation failed or pending deployment:', fnErr);
        }

        if (!isMounted) return;

        if (serverStatus) {
          console.log('[DemoContext] Server response for demo trial:', serverStatus);
          setTrialData({
            hasTrial: Boolean(serverStatus.has_trial),
            isExpired: Boolean(serverStatus.is_expired),
            trialStartedAt: serverStatus.trial_started_at,
            trialEndsAt: serverStatus.trial_ends_at,
          });
          return;
        }

        // 2. Fallback directo a la entidad DemoTrial
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
        } catch (e) {
          console.warn('[DemoContext] Error al consultar DemoTrial:', e);
        }

        if (!isMounted) return;

        // 3. Resultado estricto: Solo si existe registro en DemoTrial y no ha expirado
        if (trials && trials.length > 0) {
          console.log('[DemoContext] DemoTrial record found:', trials[0]);
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
          console.log('[DemoContext] Cuenta sin registro de DemoTrial:', cleanEmail);
          setTrialData({
            hasTrial: false,
            isExpired: true,
          });
        }
      } catch (err) {
        if (!isMounted) return;
        setTrialData({ hasTrial: false, isExpired: true });
      } finally {
        if (isMounted) setLoadingTrial(false);
      }
    };

    checkTrial();
    return () => { isMounted = false; };
  }, [userEmail, isWhitelisted]);

  // Si no está en whitelist, es usuario demo
  const isDemoUser = !isWhitelisted;
  const isTrialExpired = !isWhitelisted && (trialData?.isExpired || !trialData?.hasTrial);

  const value = useMemo(() => ({
    isDemoUser,
    isTrialExpired,
    isWhitelisted,
    trialData,
    loadingTrial,
    limits: DEMO_LIMITS,
  }), [isDemoUser, isTrialExpired, isWhitelisted, trialData, loadingTrial]);

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
      isDemoUser: false,
      isTrialExpired: false,
      isWhitelisted: true,
      trialData: null,
      loadingTrial: false,
      limits: DEMO_LIMITS,
    };
  }
  return ctx;
}
