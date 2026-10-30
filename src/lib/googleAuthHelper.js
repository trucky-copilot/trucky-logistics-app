import { base44 } from '@/api/base44Client';

export const GOOGLE_CLIENT_ID = '940005071153-h3ec1g6i15qo8nkabvrlgijbsas8g9ks.apps.googleusercontent.com';
export const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email';

// ── Almacenamiento del token ────────────────────────────────────────────────
// El access token de Google permite leer y enviar desde el buzón personal del
// usuario. Nunca se guarda en localStorage (persistente y legible por cualquier
// script de la página): vive solo en sessionStorage, que se borra al cerrar la
// pestaña y al cerrar sesión.
const TOKEN_PREFIX = 'trucky_oauth_token_';
const EMAIL_PREFIX = 'trucky_oauth_email_';

// Borra las claves que versiones anteriores dejaban en localStorage.
function purgeLegacyGoogleStorage() {
  try {
    const legacyKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith(TOKEN_PREFIX) ||
        key.startsWith(EMAIL_PREFIX) ||
        key === 'trucky_google_token' ||
        key === 'trucky_google_email'
      ) {
        legacyKeys.push(key);
      }
    }
    legacyKeys.forEach((key) => localStorage.removeItem(key));
  } catch (_) {}
}

if (typeof window !== 'undefined') {
  purgeLegacyGoogleStorage();
}

export function getStoredGoogleAuth(profileId = '1') {
  if (typeof window === 'undefined') return { token: null, email: null };
  const token = sessionStorage.getItem(`${TOKEN_PREFIX}${profileId}`) || null;
  const email = sessionStorage.getItem(`${EMAIL_PREFIX}${profileId}`) || null;
  return { token, email };
}

export function saveStoredGoogleAuth(token, email, profileId = '1') {
  if (!token) return;
  sessionStorage.setItem(`${TOKEN_PREFIX}${profileId}`, token);
  if (email) sessionStorage.setItem(`${EMAIL_PREFIX}${profileId}`, email);
}

export function clearStoredGoogleAuth(profileId = '1') {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(`${TOKEN_PREFIX}${profileId}`);
  sessionStorage.removeItem(`${EMAIL_PREFIX}${profileId}`);
}

/**
 * Solicita o renueva un token de Google OAuth 2.0.
 * Si ya se otorgaron permisos previos, Google renueva sin interrupciones.
 */
export function requestGoogleToken(promptMode = '') {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.google?.accounts?.oauth2) {
      return reject(new Error('El servicio de autenticación de Google se está inicializando. Por favor intenta en unos segundos.'));
    }

    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        callback: async (tokenResponse) => {
          if (tokenResponse?.error) {
            return reject(new Error(tokenResponse.error_description || tokenResponse.error));
          }
          if (tokenResponse?.access_token) {
            const token = tokenResponse.access_token;
            let email = null;
            try {
              const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${token}` }
              });
              const info = await infoRes.json();
              email = info.email || null;
            } catch (_) {}
            resolve({ token, email });
          } else {
            reject(new Error('No se recibió token de acceso de Google.'));
          }
        },
      });

      client.requestAccessToken({ prompt: promptMode });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Obtiene un token válido sin obligar al usuario a pasar por "Sincronizar":
 * primero intenta en silencio (permisos ya otorgados) y, si Google exige que el
 * usuario confirme la cuenta, abre la ventana de selección desde el mismo envío.
 */
async function obtainGoogleToken() {
  try {
    return await requestGoogleToken('');
  } catch (_) {
    try {
      return await requestGoogleToken('select_account');
    } catch (err) {
      throw new Error(
        err?.message ||
        'No se pudo conectar con Google. Autoriza el acceso a Gmail para enviar el correo.'
      );
    }
  }
}

/**
 * Despacho transparente de correo:
 * Si el token no existe o expiró (401/403/scope), renueva internamente sin necesidad de
 * ir manualmente a la sección de correos ni hacer clic en sincronizar.
 */
export async function sendEmailWithAutoAuth({
  to,
  subject,
  content,
  organization_id,
  profile_id = '1',
  remitente_nombre = 'Trucky User',
  categoria = 'cargas',
  load_id = null,
  threadId = null,
  inReplyTo = null,
  references = null,
  etiquetas = null,
  es_importante = false,
}) {
  let { token, email } = getStoredGoogleAuth(profile_id);

  // Si no hay token guardado en el navegador, solicitarlo antes del envío
  if (!token) {
    const authResult = await obtainGoogleToken();
    token = authResult.token;
    email = authResult.email || email;
    saveStoredGoogleAuth(token, email, profile_id);
  }

  const callSend = async (authToken, senderEmail, overrideThreadId = threadId) => {
    return await base44.functions.invoke('sendGmail', {
      accessToken: authToken,
      gmailUser: senderEmail || undefined,
      to,
      subject,
      content,
      categoria,
      organization_id,
      profile_id,
      remitente_nombre,
      load_id,
      threadId: overrideThreadId,
      inReplyTo: overrideThreadId ? inReplyTo : null,
      references: overrideThreadId ? references : null,
      etiquetas,
      es_importante,
    });
  };

  try {
    const res = await callSend(token, email);
    if (res?.data?.error) {
      const errorText = String(res.data.error).toLowerCase();
      if (errorText.includes('404') && threadId) {
        console.warn('[googleAuthHelper] threadId no existe (404), reintentando sin threadId...');
        return await callSend(token, email, null);
      }
      if (
        errorText.includes('401') ||
        errorText.includes('403') ||
        errorText.includes('autenticación') ||
        errorText.includes('insufficient permission') ||
        errorText.includes('invalid_grant') ||
        errorText.includes('scope')
      ) {
        // Renovar automáticamente y reintentar de inmediato
        const fresh = await obtainGoogleToken();
        saveStoredGoogleAuth(fresh.token, fresh.email || email, profile_id);
        return await callSend(fresh.token, fresh.email || email);
      }
    }
    return res;
  } catch (err) {
    const status = err?.status || err?.response?.status;
    const msg = String(err?.response?.data?.error || err?.message || '').toLowerCase();
    if ((status === 404 || msg.includes('404')) && threadId) {
      console.warn('[googleAuthHelper] Error 404 con threadId, reintentando como nuevo mensaje sin threadId...');
      return await callSend(token, email, null);
    }
    if (
      status === 401 ||
      status === 403 ||
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('autenticación') ||
      msg.includes('insufficient permission') ||
      msg.includes('scope') ||
      msg.includes('invalid_grant')
    ) {
      // Renovar automáticamente y reintentar
      const fresh = await obtainGoogleToken();
      saveStoredGoogleAuth(fresh.token, fresh.email || email, profile_id);
      return await callSend(fresh.token, fresh.email || email);
    }
    throw err;
  }
}