// ─────────────────────────────────────────────────────────────────────────────
// Pruebas del módulo de autenticación in-app usado por src/pages/Welcome.jsx.
//
// Cubren las funciones puras de src/lib/auth/authFlow.js. El módulo importa por
// ruta relativa (no por el alias `@/`) para poder correr bajo `deno test` sin
// levantar Vite ni resolver el alias — igual que tests/costMath.test.ts.
//
// Por qué existe este módulo: Welcome.jsx antes mandaba al usuario a la página
// de login de Base44 (marca ajena). Ahora el login pasa dentro de la app, y toda
// la lógica que se puede probar sin navegador vive acá: validación del correo,
// la máquina de estados del flujo, y el mapeo de errores de la API a mensajes
// distintos para el usuario.
//
// Correr con:  npm run test:functions  (o deno test --allow-read tests/)
// ─────────────────────────────────────────────────────────────────────────────

import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';

import {
  AUTH_STEP,
  AUTH_MODE,
  AUTH_ERROR,
  AUTH_OP,
  AUTH_MESSAGES,
  MIN_PASSWORD_LENGTH,
  isValidEmail,
  normalizeEmail,
  validateStep,
  classifyAuthError,
  INITIAL_AUTH_STATE,
  authReducer,
} from '../src/lib/auth/authFlow.js';

// Ayuda: construye un error con la forma real de Base44Error
// (ver node_modules/@base44/sdk/dist/utils/axios-client.js): .status viene de
// error.response.status, .code de response.data.code, .message de
// response.data.message || response.data.detail || error.message.
function base44Error({ status, code, message, data }: {
  status?: number;
  code?: string;
  message?: string;
  data?: unknown;
} = {}) {
  const err = new Error(message ?? 'Request failed') as Error & Record<string, unknown>;
  err.name = 'Base44Error';
  err.status = status;
  err.code = code;
  err.data = data;
  return err;
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMA DEL CORREO
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('correo: acepta formas válidas', () => {
  assert(isValidEmail('dispatcher@trucky.com'));
  assert(isValidEmail('carlos.perez+cargas@sub.dominio.co'));
  assert(isValidEmail('a@b.co'));
});

Deno.test('correo: rechaza formas inválidas', () => {
  assert(!isValidEmail(''));
  assert(!isValidEmail('   '));
  assert(!isValidEmail('sin-arroba.com'));
  assert(!isValidEmail('doble@@dominio.com'));
  assert(!isValidEmail('sin-dominio@'));
  assert(!isValidEmail('@sin-usuario.com'));
  assert(!isValidEmail('sin@punto'));
  assert(!isValidEmail('con espacio@dominio.com'));
  assert(!isValidEmail(null));
  assert(!isValidEmail(undefined));
  assert(!isValidEmail(42));
});

Deno.test('correo: normalizeEmail recorta y baja a minúsculas', () => {
  assertEquals(normalizeEmail('  Dispatcher@Trucky.COM '), 'dispatcher@trucky.com');
  assertEquals(normalizeEmail(null), '');
});

Deno.test('correo: isValidEmail tolera espacios alrededor', () => {
  assert(isValidEmail('  dispatcher@trucky.com  '));
});

// ─────────────────────────────────────────────────────────────────────────────
// VALIDACIÓN POR PASO
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('validación: credenciales sin correo válido devuelve INVALID_EMAIL', () => {
  const err = validateStep({
    step: AUTH_STEP.CREDENTIALS,
    mode: AUTH_MODE.LOGIN,
    email: 'no-es-correo',
    password: 'unaClaveLarga',
  });
  assertEquals(err?.code, AUTH_ERROR.INVALID_EMAIL);
  assertEquals(err?.message, AUTH_MESSAGES[AUTH_ERROR.INVALID_EMAIL]);
});

Deno.test('validación: credenciales sin contraseña devuelve MISSING_PASSWORD', () => {
  const err = validateStep({
    step: AUTH_STEP.CREDENTIALS,
    mode: AUTH_MODE.LOGIN,
    email: 'dispatcher@trucky.com',
    password: '',
  });
  assertEquals(err?.code, AUTH_ERROR.MISSING_PASSWORD);
});

Deno.test('validación: al iniciar sesión NO se exige largo mínimo de contraseña', () => {
  // Una cuenta vieja puede tener una clave corta; el largo mínimo es una regla
  // de registro, no de login. Exigirla al entrar bloquearía cuentas válidas.
  const err = validateStep({
    step: AUTH_STEP.CREDENTIALS,
    mode: AUTH_MODE.LOGIN,
    email: 'dispatcher@trucky.com',
    password: '123',
  });
  assertEquals(err, null);
});

Deno.test('validación: al registrarse se exige largo mínimo de contraseña', () => {
  const err = validateStep({
    step: AUTH_STEP.CREDENTIALS,
    mode: AUTH_MODE.REGISTER,
    email: 'dispatcher@trucky.com',
    password: 'corta',
  });
  assertEquals(err?.code, AUTH_ERROR.WEAK_PASSWORD);
  assert(err?.message.includes(String(MIN_PASSWORD_LENGTH)));
});

Deno.test('validación: registro con contraseña de largo suficiente pasa', () => {
  const err = validateStep({
    step: AUTH_STEP.CREDENTIALS,
    mode: AUTH_MODE.REGISTER,
    email: 'dispatcher@trucky.com',
    password: 'a'.repeat(MIN_PASSWORD_LENGTH),
  });
  assertEquals(err, null);
});

Deno.test('validación: el código OTP debe tener 6 dígitos', () => {
  const base = { step: AUTH_STEP.OTP, mode: AUTH_MODE.REGISTER, email: 'a@b.co', password: 'x' };
  assertEquals(validateStep({ ...base, otp: '12345' })?.code, AUTH_ERROR.INVALID_OTP_SHAPE);
  assertEquals(validateStep({ ...base, otp: '1234567' })?.code, AUTH_ERROR.INVALID_OTP_SHAPE);
  assertEquals(validateStep({ ...base, otp: '12a456' })?.code, AUTH_ERROR.INVALID_OTP_SHAPE);
  assertEquals(validateStep({ ...base, otp: '' })?.code, AUTH_ERROR.INVALID_OTP_SHAPE);
  assertEquals(validateStep({ ...base, otp: '123456' }), null);
  assertEquals(validateStep({ ...base, otp: ' 123456 ' }), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// MAPEO DE ERRORES — el corazón de este módulo.
//
// Los cinco casos que el usuario tiene que poder distinguir en pantalla:
// credenciales incorrectas, cuenta inexistente, código expirado, código
// incorrecto, y fallo de red. Un solo mensaje genérico para todo es el defecto
// que este módulo existe para evitar.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('errores: los cinco mensajes obligatorios son distintos entre sí', () => {
  const codes = [
    AUTH_ERROR.BAD_CREDENTIALS,
    AUTH_ERROR.NO_ACCOUNT,
    AUTH_ERROR.OTP_EXPIRED,
    AUTH_ERROR.OTP_INVALID,
    AUTH_ERROR.NETWORK,
  ];
  const messages = codes.map((c) => AUTH_MESSAGES[c]);
  messages.forEach((m) => assert(typeof m === 'string' && m.length > 0, 'falta mensaje'));
  assertEquals(new Set(messages).size, codes.length, 'hay mensajes repetidos');
});

Deno.test('errores: todo código declarado tiene un mensaje en español', () => {
  const messages = AUTH_MESSAGES as unknown as Record<string, string>;
  for (const code of Object.values(AUTH_ERROR)) {
    const msg = messages[code];
    assert(typeof msg === 'string' && msg.length > 0, `sin mensaje: ${code}`);
  }
});

// ── 1. Credenciales incorrectas ──────────────────────────────────────────────

Deno.test('errores: 401 en login sin pista de texto → BAD_CREDENTIALS', () => {
  const r = classifyAuthError(base44Error({ status: 401, message: 'Unauthorized' }), AUTH_OP.LOGIN);
  assertEquals(r.code, AUTH_ERROR.BAD_CREDENTIALS);
  assertEquals(r.message, AUTH_MESSAGES[AUTH_ERROR.BAD_CREDENTIALS]);
});

Deno.test('errores: 400 en login con "Incorrect password" → BAD_CREDENTIALS', () => {
  const r = classifyAuthError(
    base44Error({ status: 400, message: 'Incorrect password' }),
    AUTH_OP.LOGIN,
  );
  assertEquals(r.code, AUTH_ERROR.BAD_CREDENTIALS);
});

Deno.test('errores: "Invalid email or password" → BAD_CREDENTIALS, no NO_ACCOUNT', () => {
  // Trampa: el texto contiene "email" pero es un fallo de credenciales.
  const r = classifyAuthError(
    base44Error({ status: 401, message: 'Invalid email or password' }),
    AUTH_OP.LOGIN,
  );
  assertEquals(r.code, AUTH_ERROR.BAD_CREDENTIALS);
});

// ── 2. La cuenta no existe ───────────────────────────────────────────────────

Deno.test('errores: login con "User not found" → NO_ACCOUNT', () => {
  const r = classifyAuthError(
    base44Error({ status: 404, message: 'User not found' }),
    AUTH_OP.LOGIN,
  );
  assertEquals(r.code, AUTH_ERROR.NO_ACCOUNT);
  assertNotEquals(r.message, AUTH_MESSAGES[AUTH_ERROR.BAD_CREDENTIALS]);
});

Deno.test('errores: login con code NOT_FOUND → NO_ACCOUNT', () => {
  const r = classifyAuthError(base44Error({ status: 401, code: 'NOT_FOUND' }), AUTH_OP.LOGIN);
  assertEquals(r.code, AUTH_ERROR.NO_ACCOUNT);
});

Deno.test('errores: login con "is not registered" → NO_ACCOUNT', () => {
  const r = classifyAuthError(
    base44Error({ status: 403, message: 'This user is not registered for this app' }),
    AUTH_OP.LOGIN,
  );
  assertEquals(r.code, AUTH_ERROR.NO_ACCOUNT);
});

Deno.test('errores: reset de contraseña de un correo inexistente → NO_ACCOUNT', () => {
  const r = classifyAuthError(
    base44Error({ status: 404, message: 'User does not exist' }),
    AUTH_OP.RESET_REQUEST,
  );
  assertEquals(r.code, AUTH_ERROR.NO_ACCOUNT);
});

// ── 3. Código expirado ───────────────────────────────────────────────────────

Deno.test('errores: verify-otp con "OTP has expired" → OTP_EXPIRED', () => {
  const r = classifyAuthError(
    base44Error({ status: 400, message: 'OTP code has expired' }),
    AUTH_OP.VERIFY_OTP,
  );
  assertEquals(r.code, AUTH_ERROR.OTP_EXPIRED);
});

Deno.test('errores: verify-otp con code OTP_EXPIRED → OTP_EXPIRED', () => {
  const r = classifyAuthError(
    base44Error({ status: 400, code: 'OTP_EXPIRED' }),
    AUTH_OP.VERIFY_OTP,
  );
  assertEquals(r.code, AUTH_ERROR.OTP_EXPIRED);
});

Deno.test('errores: expirado gana sobre inválido cuando el texto trae los dos', () => {
  // "invalid or expired code" es una redacción real y frecuente. Decir
  // "expiró, pedí otro" es accionable; decir "está mal" manda al usuario a
  // revisar un código que ya no sirve.
  const r = classifyAuthError(
    base44Error({ status: 400, message: 'Invalid or expired code' }),
    AUTH_OP.VERIFY_OTP,
  );
  assertEquals(r.code, AUTH_ERROR.OTP_EXPIRED);
});

// ── 4. Código incorrecto ─────────────────────────────────────────────────────

Deno.test('errores: verify-otp con "Invalid OTP" → OTP_INVALID', () => {
  const r = classifyAuthError(
    base44Error({ status: 400, message: 'Invalid OTP code' }),
    AUTH_OP.VERIFY_OTP,
  );
  assertEquals(r.code, AUTH_ERROR.OTP_INVALID);
});

Deno.test('errores: verify-otp sin pista de texto → OTP_INVALID (default del paso)', () => {
  const r = classifyAuthError(base44Error({ status: 400 }), AUTH_OP.VERIFY_OTP);
  assertEquals(r.code, AUTH_ERROR.OTP_INVALID);
});

Deno.test('errores: OTP_EXPIRED y OTP_INVALID no comparten mensaje', () => {
  assertNotEquals(
    AUTH_MESSAGES[AUTH_ERROR.OTP_EXPIRED],
    AUTH_MESSAGES[AUTH_ERROR.OTP_INVALID],
  );
});

// ── 5. Fallo de red ──────────────────────────────────────────────────────────

Deno.test('errores: sin status (axios "Network Error") → NETWORK', () => {
  const r = classifyAuthError(base44Error({ message: 'Network Error' }), AUTH_OP.LOGIN);
  assertEquals(r.code, AUTH_ERROR.NETWORK);
});

Deno.test('errores: status undefined en verify-otp también es NETWORK, no OTP_INVALID', () => {
  // Sin respuesta del servidor no se puede afirmar nada del código. Culpar al
  // código sería mentirle al usuario.
  const r = classifyAuthError(base44Error({ message: 'Network Error' }), AUTH_OP.VERIFY_OTP);
  assertEquals(r.code, AUTH_ERROR.NETWORK);
});

Deno.test('errores: códigos de axios ERR_NETWORK / ECONNABORTED / ETIMEDOUT → NETWORK', () => {
  for (const code of ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT']) {
    const r = classifyAuthError(base44Error({ code }), AUTH_OP.LOGIN);
    assertEquals(r.code, AUTH_ERROR.NETWORK, `falló con ${code}`);
  }
});

Deno.test('errores: timeout de axios → NETWORK', () => {
  const r = classifyAuthError(
    base44Error({ message: 'timeout of 30000ms exceeded' }),
    AUTH_OP.LOGIN,
  );
  assertEquals(r.code, AUTH_ERROR.NETWORK);
});

Deno.test('errores: 5xx → SERVER, distinto de NETWORK', () => {
  const r = classifyAuthError(base44Error({ status: 503 }), AUTH_OP.LOGIN);
  assertEquals(r.code, AUTH_ERROR.SERVER);
  assertNotEquals(r.message, AUTH_MESSAGES[AUTH_ERROR.NETWORK]);
});

Deno.test('errores: null / undefined / no-error nunca revientan', () => {
  assertEquals(classifyAuthError(null, AUTH_OP.LOGIN).code, AUTH_ERROR.UNKNOWN);
  assertEquals(classifyAuthError(undefined, AUTH_OP.LOGIN).code, AUTH_ERROR.UNKNOWN);
  assertEquals(classifyAuthError('boom', AUTH_OP.LOGIN).code, AUTH_ERROR.UNKNOWN);
});

// ── Casos extra del registro ─────────────────────────────────────────────────

Deno.test('errores: registro de un correo ya usado → EMAIL_EXISTS', () => {
  const r = classifyAuthError(
    base44Error({ status: 409, message: 'User with this email already exists' }),
    AUTH_OP.REGISTER,
  );
  assertEquals(r.code, AUTH_ERROR.EMAIL_EXISTS);
});

Deno.test('errores: login de una cuenta sin verificar → EMAIL_NOT_VERIFIED', () => {
  const r = classifyAuthError(
    base44Error({ status: 403, message: 'Email is not verified' }),
    AUTH_OP.LOGIN,
  );
  assertEquals(r.code, AUTH_ERROR.EMAIL_NOT_VERIFIED);
});

Deno.test('errores: 429 → RATE_LIMITED', () => {
  const r = classifyAuthError(base44Error({ status: 429 }), AUTH_OP.RESEND_OTP);
  assertEquals(r.code, AUTH_ERROR.RATE_LIMITED);
});

Deno.test('errores: registro con contraseña débil rechazada por el backend → WEAK_PASSWORD', () => {
  const r = classifyAuthError(
    base44Error({ status: 400, message: 'Password too short' }),
    AUTH_OP.REGISTER,
  );
  assertEquals(r.code, AUTH_ERROR.WEAK_PASSWORD);
});

Deno.test('errores: el texto en español del backend también se clasifica', () => {
  assertEquals(
    classifyAuthError(base44Error({ status: 400, message: 'El código expiró' }), AUTH_OP.VERIFY_OTP).code,
    AUTH_ERROR.OTP_EXPIRED,
  );
  assertEquals(
    classifyAuthError(base44Error({ status: 404, message: 'El usuario no existe' }), AUTH_OP.LOGIN).code,
    AUTH_ERROR.NO_ACCOUNT,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// MÁQUINA DE ESTADOS
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('estado: el estado inicial es login sobre el paso de credenciales', () => {
  assertEquals(INITIAL_AUTH_STATE.step, AUTH_STEP.CREDENTIALS);
  assertEquals(INITIAL_AUTH_STATE.mode, AUTH_MODE.LOGIN);
  assertEquals(INITIAL_AUTH_STATE.busy, false);
  assertEquals(INITIAL_AUTH_STATE.error, null);
  assertEquals(INITIAL_AUTH_STATE.notice, null);
  assertEquals(INITIAL_AUTH_STATE.email, '');
  assertEquals(INITIAL_AUTH_STATE.password, '');
  assertEquals(INITIAL_AUTH_STATE.otp, '');
});

Deno.test('estado: el reducer nunca muta el estado que recibe', () => {
  const before = { ...INITIAL_AUTH_STATE };
  authReducer(INITIAL_AUTH_STATE, { type: 'set_field', field: 'email', value: 'a@b.co' });
  assertEquals(INITIAL_AUTH_STATE, before);
});

Deno.test('estado: una acción desconocida devuelve el mismo estado', () => {
  const s = authReducer(INITIAL_AUTH_STATE, { type: 'no-existe' });
  assertEquals(s, INITIAL_AUTH_STATE);
});

Deno.test('estado: set_field guarda el valor y limpia el error visible', () => {
  const withError = { ...INITIAL_AUTH_STATE, error: { code: AUTH_ERROR.BAD_CREDENTIALS, message: 'x' } };
  const s = authReducer(withError, { type: 'set_field', field: 'email', value: 'a@b.co' });
  assertEquals(s.email, 'a@b.co');
  assertEquals(s.error, null);
});

Deno.test('estado: submit inválido NO arranca la llamada y publica el error', () => {
  const s = authReducer(
    { ...INITIAL_AUTH_STATE, email: 'no-es-correo', password: 'algo' },
    { type: 'submit' },
  );
  assertEquals(s.busy, false);
  assertEquals(s.error?.code, AUTH_ERROR.INVALID_EMAIL);
  assertEquals(s.step, AUTH_STEP.CREDENTIALS);
});

Deno.test('estado: submit válido marca busy y limpia error y aviso', () => {
  const s = authReducer(
    {
      ...INITIAL_AUTH_STATE,
      email: 'dispatcher@trucky.com',
      password: 'unaClave',
      error: { code: AUTH_ERROR.NETWORK, message: 'x' },
      notice: 'viejo',
    },
    { type: 'submit' },
  );
  assertEquals(s.busy, true);
  assertEquals(s.error, null);
  assertEquals(s.notice, null);
});

Deno.test('estado: login exitoso llega a DONE', () => {
  const s = authReducer(
    { ...INITIAL_AUTH_STATE, email: 'a@b.co', password: 'unaClave', busy: true },
    { type: 'login_ok' },
  );
  assertEquals(s.step, AUTH_STEP.DONE);
  assertEquals(s.busy, false);
  assertEquals(s.error, null);
});

Deno.test('estado: registro exitoso pasa al paso OTP con aviso que nombra el correo', () => {
  const s = authReducer(
    { ...INITIAL_AUTH_STATE, mode: AUTH_MODE.REGISTER, email: 'nuevo@trucky.com', password: 'unaClaveLarga', busy: true },
    { type: 'register_ok' },
  );
  assertEquals(s.step, AUTH_STEP.OTP);
  assertEquals(s.busy, false);
  assert(s.notice && s.notice.includes('nuevo@trucky.com'));
});

Deno.test('estado: OTP verificado llega a DONE', () => {
  const s = authReducer(
    { ...INITIAL_AUTH_STATE, step: AUTH_STEP.OTP, mode: AUTH_MODE.REGISTER, otp: '123456', busy: true },
    { type: 'otp_ok' },
  );
  assertEquals(s.step, AUTH_STEP.DONE);
  assertEquals(s.busy, false);
});

Deno.test('estado: código expirado deja al usuario en el paso OTP con el mensaje de expirado', () => {
  const s = authReducer(
    { ...INITIAL_AUTH_STATE, step: AUTH_STEP.OTP, otp: '123456', busy: true },
    { type: 'failed', error: base44Error({ status: 400, message: 'OTP expired' }), operation: AUTH_OP.VERIFY_OTP },
  );
  assertEquals(s.step, AUTH_STEP.OTP);
  assertEquals(s.busy, false);
  assertEquals(s.error?.code, AUTH_ERROR.OTP_EXPIRED);
});

Deno.test('estado: código incorrecto deja en OTP y limpia el código tipeado', () => {
  const s = authReducer(
    { ...INITIAL_AUTH_STATE, step: AUTH_STEP.OTP, otp: '000000', busy: true },
    { type: 'failed', error: base44Error({ status: 400, message: 'Invalid code' }), operation: AUTH_OP.VERIFY_OTP },
  );
  assertEquals(s.step, AUTH_STEP.OTP);
  assertEquals(s.error?.code, AUTH_ERROR.OTP_INVALID);
  assertEquals(s.otp, '');
});

Deno.test('estado: login de cuenta sin verificar se desvía al paso OTP', () => {
  // Este es el caso "password vs OTP": el usuario intentó entrar con
  // contraseña, pero la cuenta quedó a medio registrar. En vez de un error
  // muerto, el flujo lo lleva a verificar.
  const s = authReducer(
    { ...INITIAL_AUTH_STATE, email: 'a@b.co', password: 'unaClave', busy: true },
    { type: 'failed', error: base44Error({ status: 403, message: 'Email not verified' }), operation: AUTH_OP.LOGIN },
  );
  assertEquals(s.step, AUTH_STEP.OTP);
  assertEquals(s.error?.code, AUTH_ERROR.EMAIL_NOT_VERIFIED);
});

Deno.test('estado: credenciales incorrectas se quedan en el paso de credenciales', () => {
  const s = authReducer(
    { ...INITIAL_AUTH_STATE, email: 'a@b.co', password: 'malaClave', busy: true },
    { type: 'failed', error: base44Error({ status: 401 }), operation: AUTH_OP.LOGIN },
  );
  assertEquals(s.step, AUTH_STEP.CREDENTIALS);
  assertEquals(s.error?.code, AUTH_ERROR.BAD_CREDENTIALS);
  assertEquals(s.busy, false);
});

Deno.test('estado: correo ya registrado devuelve al modo login conservando el correo', () => {
  const s = authReducer(
    { ...INITIAL_AUTH_STATE, mode: AUTH_MODE.REGISTER, email: 'ya@trucky.com', password: 'unaClaveLarga', busy: true },
    { type: 'failed', error: base44Error({ status: 409, message: 'already exists' }), operation: AUTH_OP.REGISTER },
  );
  assertEquals(s.mode, AUTH_MODE.LOGIN);
  assertEquals(s.step, AUTH_STEP.CREDENTIALS);
  assertEquals(s.email, 'ya@trucky.com');
  assertEquals(s.error?.code, AUTH_ERROR.EMAIL_EXISTS);
});

Deno.test('estado: set_mode cambia de modo, conserva el correo y limpia contraseña y error', () => {
  const s = authReducer(
    {
      ...INITIAL_AUTH_STATE,
      email: 'a@b.co',
      password: 'algo',
      error: { code: AUTH_ERROR.BAD_CREDENTIALS, message: 'x' },
    },
    { type: 'set_mode', mode: AUTH_MODE.REGISTER },
  );
  assertEquals(s.mode, AUTH_MODE.REGISTER);
  assertEquals(s.email, 'a@b.co');
  assertEquals(s.password, '');
  assertEquals(s.error, null);
  assertEquals(s.step, AUTH_STEP.CREDENTIALS);
});

Deno.test('estado: reset_submit con correo inválido no arranca la llamada', () => {
  const s = authReducer({ ...INITIAL_AUTH_STATE, email: 'nope' }, { type: 'reset_submit' });
  assertEquals(s.busy, false);
  assertEquals(s.error?.code, AUTH_ERROR.INVALID_EMAIL);
});

Deno.test('estado: reset_submit solo exige el correo, no la contraseña', () => {
  const s = authReducer(
    { ...INITIAL_AUTH_STATE, email: 'a@b.co', password: '' },
    { type: 'reset_submit' },
  );
  assertEquals(s.busy, true);
  assertEquals(s.error, null);
});

Deno.test('estado: reset enviado llega a RESET_SENT con confirmación en pantalla', () => {
  const s = authReducer(
    { ...INITIAL_AUTH_STATE, email: 'a@b.co', busy: true },
    { type: 'reset_sent' },
  );
  assertEquals(s.step, AUTH_STEP.RESET_SENT);
  assertEquals(s.busy, false);
  assert(s.notice && s.notice.includes('a@b.co'));
});

Deno.test('estado: otp_resend_submit solo exige el correo, no el código tipeado', () => {
  // Pedir un código nuevo no puede depender de que el código viejo sea válido:
  // el usuario pide otro justamente porque el que tiene no sirve.
  const s = authReducer(
    { ...INITIAL_AUTH_STATE, step: AUTH_STEP.OTP, email: 'a@b.co', otp: '' },
    { type: 'otp_resend_submit' },
  );
  assertEquals(s.busy, true);
  assertEquals(s.error, null);
  assertEquals(s.step, AUTH_STEP.OTP);
});

Deno.test('estado: otp_resend_submit con correo inválido no arranca la llamada', () => {
  const s = authReducer(
    { ...INITIAL_AUTH_STATE, step: AUTH_STEP.OTP, email: 'roto' },
    { type: 'otp_resend_submit' },
  );
  assertEquals(s.busy, false);
  assertEquals(s.error?.code, AUTH_ERROR.INVALID_EMAIL);
});

Deno.test('estado: otp_resent avisa y limpia el error anterior', () => {
  const s = authReducer(
    {
      ...INITIAL_AUTH_STATE,
      step: AUTH_STEP.OTP,
      email: 'a@b.co',
      busy: true,
      error: { code: AUTH_ERROR.OTP_EXPIRED, message: 'x' },
    },
    { type: 'otp_resent' },
  );
  assertEquals(s.step, AUTH_STEP.OTP);
  assertEquals(s.busy, false);
  assertEquals(s.error, null);
  assert(s.notice && s.notice.length > 0);
});

Deno.test('estado: back_to_credentials vuelve al inicio del flujo limpiando el código', () => {
  const s = authReducer(
    {
      ...INITIAL_AUTH_STATE,
      step: AUTH_STEP.OTP,
      email: 'a@b.co',
      otp: '123456',
      error: { code: AUTH_ERROR.OTP_INVALID, message: 'x' },
      notice: 'algo',
    },
    { type: 'back_to_credentials' },
  );
  assertEquals(s.step, AUTH_STEP.CREDENTIALS);
  assertEquals(s.otp, '');
  assertEquals(s.error, null);
  assertEquals(s.notice, null);
  assertEquals(s.email, 'a@b.co');
});

Deno.test('estado: DONE es terminal — ninguna acción posterior lo saca de ahí', () => {
  // Si el shell despacha algo tarde (una promesa que resolvió después de que el
  // usuario ya entró), no puede devolverlo a la pantalla de login.
  const done = authReducer(
    { ...INITIAL_AUTH_STATE, email: 'a@b.co', password: 'x', busy: true },
    { type: 'login_ok' },
  );
  for (
    const action of [
      { type: 'failed', error: base44Error({ status: 401 }), operation: AUTH_OP.LOGIN },
      { type: 'submit' },
      { type: 'set_field', field: 'email', value: 'otro@b.co' },
      { type: 'back_to_credentials' },
    ]
  ) {
    assertEquals(authReducer(done, action).step, AUTH_STEP.DONE);
  }
});

Deno.test('estado: el flujo completo de registro llega a DONE', () => {
  let s: Record<string, unknown> = INITIAL_AUTH_STATE;
  s = authReducer(s, { type: 'set_mode', mode: AUTH_MODE.REGISTER });
  s = authReducer(s, { type: 'set_field', field: 'email', value: 'nuevo@trucky.com' });
  s = authReducer(s, { type: 'set_field', field: 'password', value: 'unaClaveSegura' });
  s = authReducer(s, { type: 'submit' });
  assertEquals(s.busy, true);
  s = authReducer(s, { type: 'register_ok' });
  assertEquals(s.step, AUTH_STEP.OTP);
  s = authReducer(s, { type: 'set_field', field: 'otp', value: '123456' });
  s = authReducer(s, { type: 'submit' });
  assertEquals(s.busy, true);
  s = authReducer(s, { type: 'otp_ok' });
  assertEquals(s.step, AUTH_STEP.DONE);
});
