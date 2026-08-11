// ─────────────────────────────────────────────────────────────────────────────
// AUTENTICACIÓN IN-APP — lógica pura del login, el registro con código y el
// restablecimiento de contraseña. La importa src/pages/Welcome.jsx (vía el alias
// `@/lib/auth/authFlow`) y tests/authFlow.test.ts (vía ruta relativa).
//
// POR QUÉ EXISTE: antes Welcome.jsx llamaba a `base44.auth.redirectToLogin()`,
// que manda el navegador a la página de login de Base44 — otra marca, otro
// producto, en la primera pantalla que ve un prospecto. El login ahora pasa
// dentro de la app, y toda la lógica que no necesita navegador vive acá para
// poder probarse: forma del correo, la máquina de estados del flujo, y el mapeo
// de errores de la API a mensajes distintos para el usuario.
//
// RESTRICCIÓN DURA: este módulo NO puede tener imports (misma razón que
// src/lib/freight/costMath.js).
//   - `deno test` no tiene `deno.json` ni import map en este repo, así que no
//     hay forma de resolver el alias `@/...` que usa Vite (jsconfig.json) — un
//     solo import con `@/` rompería la corrida de `deno test`.
//   - Tampoco puede usar specifiers `npm:`, ni JSX, ni nada del DOM.
// El componente de React sí puede usar el alias normalmente.
//
// Welcome.jsx queda como una cáscara delgada: pinta el estado que devuelve
// `authReducer` y hace las llamadas al SDK. Lógica que viva en el componente es
// lógica que en este repo no se puede probar (no hay runner de React, y no se va
// a agregar uno a una semana de la demo).
// ─────────────────────────────────────────────────────────────────────────────

/** Pasos del flujo. `done` es terminal: la app ya tiene sesión. */
export const AUTH_STEP = Object.freeze({
  CREDENTIALS: 'credentials', // correo + contraseña
  OTP: 'otp', // código de 6 dígitos enviado por correo
  RESET_SENT: 'reset_sent', // confirmación de "olvidé mi contraseña"
  DONE: 'done', // con sesión — el shell debe entrar a la app
});

/** El mismo formulario sirve para entrar o para crear cuenta. */
export const AUTH_MODE = Object.freeze({
  LOGIN: 'login',
  REGISTER: 'register',
});

/** Operación del SDK que falló — el mapeo de errores depende del contexto. */
export const AUTH_OP = Object.freeze({
  LOGIN: 'login', // loginViaEmailPassword
  REGISTER: 'register', // register
  VERIFY_OTP: 'verify_otp', // verifyOtp
  RESEND_OTP: 'resend_otp', // resendOtp
  RESET_REQUEST: 'reset_request', // resetPasswordRequest
});

export const AUTH_ERROR = Object.freeze({
  // Fallos de la API
  NETWORK: 'network',
  SERVER: 'server',
  BAD_CREDENTIALS: 'bad_credentials',
  NO_ACCOUNT: 'no_account',
  EMAIL_EXISTS: 'email_exists',
  EMAIL_NOT_VERIFIED: 'email_not_verified',
  OTP_EXPIRED: 'otp_expired',
  OTP_INVALID: 'otp_invalid',
  WEAK_PASSWORD: 'weak_password',
  RATE_LIMITED: 'rate_limited',
  UNKNOWN: 'unknown',
  // Validaciones locales, antes de gastar una llamada
  INVALID_EMAIL: 'invalid_email',
  MISSING_PASSWORD: 'missing_password',
  INVALID_OTP_SHAPE: 'invalid_otp_shape',
});

/** Largo mínimo exigido al crear la cuenta (no al entrar a una que ya existe). */
export const MIN_PASSWORD_LENGTH = 8;

export const OTP_LENGTH = 6;

/**
 * Un mensaje distinto por causa. Los cinco que el ticket exige distinguir son
 * BAD_CREDENTIALS, NO_ACCOUNT, OTP_EXPIRED, OTP_INVALID y NETWORK: un solo
 * mensaje genérico para todo es exactamente el defecto que hay que evitar.
 * Registro tú/neutro, igual que el resto de la pantalla de bienvenida.
 */
export const AUTH_MESSAGES = Object.freeze({
  [AUTH_ERROR.NETWORK]:
    'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.',
  [AUTH_ERROR.SERVER]:
    'El servicio no está respondiendo en este momento. Intenta de nuevo en unos minutos.',
  [AUTH_ERROR.BAD_CREDENTIALS]: 'El correo o la contraseña no son correctos.',
  [AUTH_ERROR.NO_ACCOUNT]:
    'No existe una cuenta con ese correo. Crea una cuenta para continuar.',
  [AUTH_ERROR.EMAIL_EXISTS]:
    'Ya existe una cuenta con ese correo. Inicia sesión con tu contraseña.',
  [AUTH_ERROR.EMAIL_NOT_VERIFIED]:
    'Tu cuenta todavía no está verificada. Ingresa el código que te enviamos por correo.',
  [AUTH_ERROR.OTP_EXPIRED]: 'El código expiró. Solicita uno nuevo para continuar.',
  [AUTH_ERROR.OTP_INVALID]: 'El código no es correcto. Revísalo e intenta de nuevo.',
  [AUTH_ERROR.WEAK_PASSWORD]: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
  [AUTH_ERROR.RATE_LIMITED]: 'Demasiados intentos. Espera un minuto e intenta de nuevo.',
  [AUTH_ERROR.UNKNOWN]: 'No pudimos completar la operación. Intenta de nuevo.',
  [AUTH_ERROR.INVALID_EMAIL]: 'Escribe un correo electrónico válido.',
  [AUTH_ERROR.MISSING_PASSWORD]: 'Escribe tu contraseña.',
  [AUTH_ERROR.INVALID_OTP_SHAPE]: `El código son ${OTP_LENGTH} dígitos. Revisa el correo que te enviamos.`,
});

/** Empareja un código con su mensaje. Forma única de todo error del flujo. */
function errorFor(code) {
  return { code, message: AUTH_MESSAGES[code] || AUTH_MESSAGES[AUTH_ERROR.UNKNOWN] };
}

// ─────────────────────────────────────────────────────────────────────────────
// CORREO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exige usuario, un solo `@`, dominio y un TLD de dos caracteres o más. No
 * pretende implementar RFC 5322: solo atajar el error de tipeo antes de gastar
 * una llamada, porque quien valida de verdad es el backend.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[^\s@.]{2,}$/;

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isValidEmail(value) {
  if (typeof value !== 'string') return false;
  return EMAIL_RE.test(value.trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDACIÓN POR PASO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valida los campos del paso actual. Devuelve `null` si se puede llamar a la
 * API, o `{ code, message }` si no.
 *
 * El largo mínimo de contraseña se exige solo al registrarse: una cuenta creada
 * antes puede tener una clave corta y válida, y exigirlo al entrar la dejaría
 * fuera de la app sin razón.
 */
export function validateStep(state) {
  const step = state?.step || AUTH_STEP.CREDENTIALS;

  if (step === AUTH_STEP.OTP) {
    const otp = String(state?.otp ?? '').trim();
    if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(otp)) {
      return errorFor(AUTH_ERROR.INVALID_OTP_SHAPE);
    }
    return null;
  }

  if (step === AUTH_STEP.CREDENTIALS) {
    if (!isValidEmail(state?.email)) return errorFor(AUTH_ERROR.INVALID_EMAIL);
    const password = String(state?.password ?? '');
    if (password.length === 0) return errorFor(AUTH_ERROR.MISSING_PASSWORD);
    if (state?.mode === AUTH_MODE.REGISTER && password.length < MIN_PASSWORD_LENGTH) {
      return errorFor(AUTH_ERROR.WEAK_PASSWORD);
    }
    return null;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAPEO DE ERRORES DE LA API
//
// El SDK lanza `Base44Error` (ver node_modules/@base44/sdk/dist/utils/
// axios-client.js), con:
//   .status  → error.response?.status  — ausente si la petición nunca respondió
//   .code    → response.data?.code     — código de la API, cuando lo manda
//   .message → response.data?.message || response.data?.detail || error.message
//   .data    → cuerpo completo de la respuesta
//
// LÍMITE CONOCIDO: Base44 no documenta los textos ni los códigos exactos de sus
// respuestas de auth, así que la clasificación combina el código de la API con
// patrones de texto (inglés y español) y, si nada calza, cae a un default por
// operación. El default nunca es un mensaje genérico: es el motivo más probable
// de ese paso. Si al probar contra el backend real aparece un texto que no
// calza, se agrega el patrón acá y la prueba correspondiente en
// tests/authFlow.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Códigos de axios que significan "nunca hubo respuesta del servidor". */
const NETWORK_CODES = new Set([
  'ERR_NETWORK',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ERR_CANCELED',
  'ENOTFOUND',
]);

const PATTERNS = Object.freeze({
  EXPIRED: /expir|venci|caduc/,
  NOT_VERIFIED: /not[\s_-]*verified|unverified|no[\s_-]*verificad|sin[\s_-]*verificar|verify[\s_-]*your[\s_-]*email/,
  ALREADY_EXISTS: /already[\s_-]*(exists|registered|in[\s_-]*use|taken)|ya[\s_-]*(existe|está[\s_-]*registrad)|duplicate|user[\s_-]*exists|email[\s_-]*taken/,
  NOT_FOUND: /not[\s_-]*found|does[\s_-]*not[\s_-]*exist|doesn'?t[\s_-]*exist|no[\s_-]*existe|not[\s_-]*registered|no[\s_-]*such[\s_-]*user|unknown[\s_-]*user/,
  BAD_CREDENTIALS: /invalid[\s_-]*credential|bad[\s_-]*credential|incorrect[\s_-]*password|wrong[\s_-]*password|invalid[\s_-]*email[\s_-]*or[\s_-]*password|invalid[\s_-]*password|credencial|contraseña[\s_-]*incorrect/,
  WEAK_PASSWORD: /too[\s_-]*short|weak[\s_-]*password|password[\s_-]*too|at[\s_-]*least[\s_-]*\d+[\s_-]*char|muy[\s_-]*corta|password[\s_-]*length/,
  WRONG_VALUE: /invalid|incorrect|wrong|mismatch|inválid|invalid|no[\s_-]*coincide|erróne/,
  RATE_LIMIT: /too[\s_-]*many|rate[\s_-]*limit|demasiados/,
});

function isOtpOperation(operation) {
  return operation === AUTH_OP.VERIFY_OTP || operation === AUTH_OP.RESEND_OTP;
}

/**
 * Traduce un error del SDK a un `{ code, message }` accionable para el usuario.
 *
 * @param {unknown} error      Lo que rechazó la promesa del SDK.
 * @param {string}  operation  Una de AUTH_OP — da el contexto del default.
 */
export function classifyAuthError(error, operation) {
  const op = operation || AUTH_OP.LOGIN;

  if (!error || typeof error !== 'object') return errorFor(AUTH_ERROR.UNKNOWN);

  const status = typeof error.status === 'number' ? error.status : undefined;
  const apiCode = typeof error.code === 'string' ? error.code : '';

  // 1. Sin respuesta del servidor. Se decide antes que todo lo demás: sin
  //    status no se puede afirmar nada del contenido, y culpar al código o a la
  //    contraseña sería mentirle al usuario.
  if (NETWORK_CODES.has(apiCode.toUpperCase())) return errorFor(AUTH_ERROR.NETWORK);
  if (status === undefined) return errorFor(AUTH_ERROR.NETWORK);

  // 2. Familias que se deducen solo del status.
  if (status === 429) return errorFor(AUTH_ERROR.RATE_LIMITED);
  if (status >= 500) return errorFor(AUTH_ERROR.SERVER);

  // 3. Código de la API + texto, en un solo pajar.
  const texts = [
    apiCode,
    error.message,
    error.data?.detail,
    error.data?.message,
    error.data?.error,
    error.data?.extra_data?.reason,
  ].filter((t) => typeof t === 'string');
  const hay = texts.join(' ').toLowerCase();

  // Expirado antes que incorrecto: "invalid or expired code" es una redacción
  // real y frecuente, y "expiró, pide otro" es accionable, mientras que "está
  // mal" manda al usuario a revisar un código que ya no sirve.
  if (isOtpOperation(op) && PATTERNS.EXPIRED.test(hay)) return errorFor(AUTH_ERROR.OTP_EXPIRED);

  if (PATTERNS.NOT_VERIFIED.test(hay)) return errorFor(AUTH_ERROR.EMAIL_NOT_VERIFIED);
  if (PATTERNS.ALREADY_EXISTS.test(hay)) return errorFor(AUTH_ERROR.EMAIL_EXISTS);
  if (PATTERNS.NOT_FOUND.test(hay)) return errorFor(AUTH_ERROR.NO_ACCOUNT);
  if (PATTERNS.BAD_CREDENTIALS.test(hay)) return errorFor(AUTH_ERROR.BAD_CREDENTIALS);

  if (op === AUTH_OP.REGISTER && PATTERNS.WEAK_PASSWORD.test(hay)) {
    return errorFor(AUTH_ERROR.WEAK_PASSWORD);
  }
  if (PATTERNS.RATE_LIMIT.test(hay)) return errorFor(AUTH_ERROR.RATE_LIMITED);
  if (isOtpOperation(op) && PATTERNS.WRONG_VALUE.test(hay)) return errorFor(AUTH_ERROR.OTP_INVALID);

  // 4. Default por operación — el motivo más probable de ese paso, nunca un
  //    mensaje genérico compartido.
  if (isOtpOperation(op)) return errorFor(AUTH_ERROR.OTP_INVALID);
  if (op === AUTH_OP.LOGIN && (status === 400 || status === 401 || status === 403)) {
    return errorFor(AUTH_ERROR.BAD_CREDENTIALS);
  }
  if (op === AUTH_OP.LOGIN && status === 404) return errorFor(AUTH_ERROR.NO_ACCOUNT);

  return errorFor(AUTH_ERROR.UNKNOWN);
}

// ─────────────────────────────────────────────────────────────────────────────
// MÁQUINA DE ESTADOS
// ─────────────────────────────────────────────────────────────────────────────

export const INITIAL_AUTH_STATE = Object.freeze({
  step: AUTH_STEP.CREDENTIALS,
  mode: AUTH_MODE.LOGIN,
  email: '',
  password: '',
  otp: '',
  busy: false,
  error: null,
  notice: null,
});

const EDITABLE_FIELDS = new Set(['email', 'password', 'otp']);

/**
 * Reducer del flujo. El componente solo despacha acciones y pinta el resultado.
 *
 * Acciones que salen del usuario:
 *   set_field / set_mode / submit / reset_submit / back_to_credentials
 * Acciones que salen del resultado de una llamada al SDK:
 *   login_ok / register_ok / otp_ok / otp_resent / reset_sent /
 *   failed { error, operation }
 *
 * `done` es terminal a propósito: si una promesa vieja resuelve después de que
 * el usuario ya entró, no puede devolverlo a la pantalla de login.
 */
export function authReducer(state, action) {
  if (!state) return INITIAL_AUTH_STATE;
  if (!action || typeof action.type !== 'string') return state;
  if (state.step === AUTH_STEP.DONE) return state;

  switch (action.type) {
    case 'set_field': {
      if (!EDITABLE_FIELDS.has(action.field)) return state;
      return { ...state, [action.field]: action.value ?? '', error: null };
    }

    case 'set_mode': {
      if (action.mode !== AUTH_MODE.LOGIN && action.mode !== AUTH_MODE.REGISTER) return state;
      if (action.mode === state.mode) return state;
      // Se conserva el correo ya tipeado; la contraseña se limpia porque el
      // requisito de largo cambia entre entrar y registrarse.
      return {
        ...state,
        mode: action.mode,
        step: AUTH_STEP.CREDENTIALS,
        password: '',
        otp: '',
        busy: false,
        error: null,
        notice: null,
      };
    }

    case 'submit': {
      const invalid = validateStep(state);
      if (invalid) return { ...state, busy: false, error: invalid };
      return { ...state, busy: true, error: null, notice: null };
    }

    // Ambas llamadas solo necesitan el correo: "olvidé mi contraseña" y "envíame
    // otro código". La segunda no puede exigir que el código tipeado sea válido
    // — el usuario pide otro justamente porque el que tiene no sirve.
    case 'reset_submit':
    case 'otp_resend_submit': {
      if (!isValidEmail(state.email)) {
        return { ...state, busy: false, error: errorFor(AUTH_ERROR.INVALID_EMAIL) };
      }
      return { ...state, busy: true, error: null, notice: null };
    }

    case 'login_ok':
    case 'otp_ok':
      return {
        ...state,
        step: AUTH_STEP.DONE,
        busy: false,
        error: null,
        notice: null,
        password: '',
        otp: '',
      };

    case 'register_ok':
      return {
        ...state,
        step: AUTH_STEP.OTP,
        busy: false,
        error: null,
        otp: '',
        notice: `Te enviamos un código de ${OTP_LENGTH} dígitos a ${normalizeEmail(state.email)}. Ingrésalo para activar tu cuenta.`,
      };

    case 'otp_resent':
      return {
        ...state,
        step: AUTH_STEP.OTP,
        busy: false,
        error: null,
        otp: '',
        notice: `Te enviamos un código nuevo a ${normalizeEmail(state.email)}.`,
      };

    case 'reset_sent':
      return {
        ...state,
        step: AUTH_STEP.RESET_SENT,
        busy: false,
        error: null,
        password: '',
        notice: `Te enviamos las instrucciones para restablecer tu contraseña a ${normalizeEmail(state.email)}. Revisa tu correo.`,
      };

    case 'failed': {
      const failure = classifyAuthError(action.error, action.operation);
      const next = { ...state, busy: false, error: failure, notice: null };

      // La cuenta existe pero quedó a medio registrar: en vez de un error sin
      // salida, el flujo lleva al usuario a verificar el correo.
      if (failure.code === AUTH_ERROR.EMAIL_NOT_VERIFIED) {
        next.step = AUTH_STEP.OTP;
        next.otp = '';
        return next;
      }

      // Ya hay cuenta con ese correo: el usuario quería entrar, no registrarse.
      if (failure.code === AUTH_ERROR.EMAIL_EXISTS) {
        next.mode = AUTH_MODE.LOGIN;
        next.step = AUTH_STEP.CREDENTIALS;
        next.password = '';
        return next;
      }

      // Un código quemado no se deja en pantalla.
      if (failure.code === AUTH_ERROR.OTP_INVALID || failure.code === AUTH_ERROR.OTP_EXPIRED) {
        next.otp = '';
      }

      return next;
    }

    case 'back_to_credentials':
      return {
        ...state,
        step: AUTH_STEP.CREDENTIALS,
        otp: '',
        busy: false,
        error: null,
        notice: null,
      };

    default:
      return state;
  }
}
