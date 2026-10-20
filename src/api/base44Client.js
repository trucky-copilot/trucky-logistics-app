import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

// Create a client with authentication required
export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
});

// ─── Puente de desarrollo local aislado para Gmail (Sin tocar producción) ────
const isLocalhost = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

if (isLocalhost) {
  // 1. Interceptar invocaciones de backend para Gmail
  const originalInvoke = base44.functions.invoke.bind(base44.functions);
  base44.functions.invoke = async (functionName, payload) => {
    if (functionName === 'sendGmail') {
      const res = await fetch('/api/local-functions/sendGmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      return { data };
    }

    if (functionName === 'syncGmail') {
      const res = await fetch('/api/local-functions/syncGmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      return { data };
    }

    return originalInvoke(functionName, payload);
  };

  // 2. Interceptar entidad Email para lectura y actualización local en desarrollo mediante Proxy
  const originalEntities = base44.entities;
  const localEmailHandler = {
    filter: async (_query, _sort, _limit) => {
      try {
        const res = await fetch('/api/local-emails');
        return await res.json();
      } catch (_) {
        return [];
      }
    },
    list: async (_sort, _limit) => {
      try {
        const res = await fetch('/api/local-emails');
        return await res.json();
      } catch (_) {
        return [];
      }
    },
    update: async (id, patch) => {
      try {
        const res = await fetch(`/api/local-emails/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch)
        });
        return await res.json();
      } catch (_) {
        return patch;
      }
    },
    create: async (record) => {
      return record;
    }
  };

  base44.entities = new Proxy(originalEntities, {
    get(target, prop, receiver) {
      if (prop === 'Email') {
        return localEmailHandler;
      }
      return Reflect.get(target, prop, receiver);
    }
  });
}

