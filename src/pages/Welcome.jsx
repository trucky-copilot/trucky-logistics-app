import { useReducer } from 'react';
import { Truck, Shield, BarChart3, FileSearch, Loader2, ArrowLeft, MailCheck } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import {
  AUTH_STEP,
  AUTH_MODE,
  AUTH_OP,
  INITIAL_AUTH_STATE,
  OTP_LENGTH,
  authReducer,
  isValidEmail,
  normalizeEmail,
  validateStep,
} from '@/lib/auth/authFlow';

// ─────────────────────────────────────────────────────────────────────────────
// PANTALLA DE BIENVENIDA — también hace el login, dentro de la app.
//
// Antes, el único botón llamaba a `base44.auth.redirectToLogin()`, que manda el
// navegador a app.base44.com/login: otra marca y otro producto en la primera
// pantalla que ve un prospecto. No hay opción de white-label en la plataforma,
// así que el correo y la contraseña se piden acá y se autentica con el SDK.
//
// Este componente es una cáscara delgada a propósito: toda la lógica (validar
// el correo, decidir el paso siguiente, traducir errores de la API a mensajes
// distintos) vive en `@/lib/auth/authFlow`, que sí tiene pruebas — ver
// tests/authFlow.test.ts. El repo no tiene runner de React, así que lógica
// escrita acá dentro es lógica que no se puede probar.
// ─────────────────────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: FileSearch, label: 'Verifica Rate Confirmations', desc: 'Análisis automático de documentos con IA' },
  { icon: BarChart3,  label: 'Calcula rentabilidad',        desc: 'Tarifa por milla, break-even y objetivos' },
  { icon: Truck,      label: 'Gestiona tu flota',            desc: 'Conductores, camiones y cargas en un solo lugar' },
  { icon: Shield,     label: 'Datos 100% privados',          desc: 'Cada empresa opera en su propio espacio' },
];

const INPUT_CLASS =
  'mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60';

const PRIMARY_BUTTON_CLASS =
  'w-full py-3 rounded-xl bg-primary hover:bg-primary/90 text-sm font-bold text-primary-foreground transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2';

const LINK_CLASS =
  'text-[11px] text-violet-300/80 hover:text-violet-200 font-medium transition-colors disabled:opacity-60';

/** Logo de Google — inline para no depender de una red externa ni de un asset. */
function GoogleMark() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.8 2.6 13.6l7.8 6c1.9-5.7 7.2-9.9 13.6-9.9z" />
      <path fill="#4285F4" d="M46.5 24c0-1.6-.1-2.8-.4-4.1H24v8.4h12.8c-.3 2.1-1.6 5.3-4.7 7.4l7.6 5.9c4.5-4.2 6.8-10.3 6.8-17.6z" />
      <path fill="#FBBC05" d="M10.4 28.4c-.5-1.4-.8-2.9-.8-4.4s.3-3 .8-4.4l-7.8-6C.9 16.7 0 20.2 0 24s.9 7.3 2.6 10.4l7.8-6z" />
      <path fill="#34A853" d="M24 47.5c6.2 0 11.4-2 15.2-5.6l-7.6-5.9c-2 1.4-4.7 2.4-7.6 2.4-6.4 0-11.7-4.2-13.6-9.9l-7.8 6C6.5 42.2 14.6 47.5 24 47.5z" />
    </svg>
  );
}

export default function Welcome() {
  const [state, dispatch] = useReducer(authReducer, INITIAL_AUTH_STATE);
  const { step, mode, email, password, otp, busy, error, notice } = state;

  const isRegister = mode === AUTH_MODE.REGISTER;
  const setField = (field) => (e) => dispatch({ type: 'set_field', field, value: e.target.value });

  /**
   * Entrada a la app después de autenticar. Recarga la página a propósito, en
   * vez de re-resolver el estado en memoria.
   *
   * POR QUÉ: `loginViaEmailPassword` guarda el token con `setToken`, que escribe
   * `base44_access_token` en localStorage. Pero el acceso lo resuelven dos
   * contextos que ya corrieron al montar:
   *   - `src/lib/AuthContext.jsx` decide si hay sesión leyendo `appParams.token`,
   *     y `src/lib/app-params.js` calcula `appParams` UNA sola vez al importarse
   *     el módulo. Ese objeto no se recalcula: ya quedó con token `null`.
   *   - `src/lib/AppStateContext.jsx` resuelve con `base44.auth.me()`.
   * Llamar solo a `resolveState()` dejaría entrar a la app, pero con
   * `useAuth().user === null` — y `src/components/Layout.jsx` lee `user.email`
   * para el menú de perfil, así que la app quedaría a medio autenticar.
   *
   * Con la recarga, `app-params.js` vuelve a leer el token de localStorage y los
   * dos contextos resuelven desde cero: exactamente el mismo camino que ya
   * recorre hoy la app en cada carga autenticada.
   */
  const enterApp = () => window.location.reload();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;

    dispatch({ type: 'submit' });
    // El reducer ya publicó el error de validación; no se gasta una llamada.
    if (validateStep(state)) return;

    const correo = normalizeEmail(email);

    if (step === AUTH_STEP.OTP) {
      // Los dos tramos se atrapan por separado a propósito: si el código era
      // bueno y lo que falló fue la entrada con la contraseña, decirle al
      // usuario que el código está mal lo manda a buscar el problema donde no
      // está.
      let verificado;
      try {
        verificado = await base44.auth.verifyOtp({ email: correo, otpCode: String(otp).trim() });
      } catch (err) {
        dispatch({ type: 'failed', error: err, operation: AUTH_OP.VERIFY_OTP });
        return;
      }
      try {
        // Según el SDK, verify-otp puede devolver ya el access_token del usuario
        // recién verificado. Si no lo trae, se entra con la contraseña que el
        // usuario acaba de usar para registrarse.
        if (verificado?.access_token) base44.auth.setToken(verificado.access_token);
        else await base44.auth.loginViaEmailPassword(correo, password);
        dispatch({ type: 'otp_ok' });
        enterApp();
      } catch (err) {
        dispatch({ type: 'failed', error: err, operation: AUTH_OP.LOGIN });
      }
      return;
    }

    if (isRegister) {
      try {
        await base44.auth.register({ email: correo, password });
        dispatch({ type: 'register_ok' });
      } catch (err) {
        dispatch({ type: 'failed', error: err, operation: AUTH_OP.REGISTER });
      }
      return;
    }

    try {
      await base44.auth.loginViaEmailPassword(correo, password);
      dispatch({ type: 'login_ok' });
      enterApp();
    } catch (err) {
      dispatch({ type: 'failed', error: err, operation: AUTH_OP.LOGIN });
    }
  };

  const handleForgotPassword = async () => {
    if (busy) return;
    dispatch({ type: 'reset_submit' });
    if (!isValidEmail(email)) return;
    try {
      await base44.auth.resetPasswordRequest(normalizeEmail(email));
      dispatch({ type: 'reset_sent' });
    } catch (err) {
      dispatch({ type: 'failed', error: err, operation: AUTH_OP.RESET_REQUEST });
    }
  };

  const handleResendOtp = async () => {
    if (busy) return;
    dispatch({ type: 'otp_resend_submit' });
    if (!isValidEmail(email)) return;
    try {
      await base44.auth.resendOtp(normalizeEmail(email));
      dispatch({ type: 'otp_resent' });
    } catch (err) {
      dispatch({ type: 'failed', error: err, operation: AUTH_OP.RESEND_OTP });
    }
  };

  // Google sigue siendo un redirect: mandar a la pantalla de Google es normal en
  // cualquier producto y no expone la plataforma sobre la que corre Trucky.
  const handleGoogleLogin = () =>
    base44.auth.loginWithProvider('google', window.location.pathname);

  return (
    // El scroll vive en el contenedor externo: con el formulario, la pantalla ya
    // no siempre entra en un viewport de teléfono, y sin esto los campos de
    // abajo quedan fuera de alcance.
    <div className="fixed inset-0 bg-background overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center p-6">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-violet-500 to-indigo-700 shadow-xl shadow-violet-500/30">
            <span className="text-white font-black text-3xl leading-none">t</span>
          </div>
          <div className="leading-tight">
            <div className="text-3xl font-black text-foreground tracking-tight lowercase">trucky</div>
            <div className="text-sm text-violet-300/80 font-medium">Your road co-pilot</div>
          </div>
        </div>

        {/* Headline */}
        <div className="text-center mb-8 max-w-sm">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Operaciones de transporte,{' '}
            <span className="text-primary">sin complicaciones</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Plataforma para carriers y dispatchers intermodales. Crea tu cuenta gratuita y comienza hoy.
          </p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-2 gap-3 mb-8 w-full max-w-sm">
          {FEATURES.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-3 flex flex-col gap-1.5">
              <Icon className="w-4 h-4 text-primary" />
              <div className="text-xs font-semibold text-foreground">{label}</div>
              <div className="text-[11px] text-muted-foreground leading-snug">{desc}</div>
            </div>
          ))}
        </div>

        {/* Acceso */}
        <div className="w-full max-w-sm space-y-3">
          {/* Aviso y error: siempre en el mismo lugar, uno por vez. */}
          {notice && (
            <p className="text-[11px] text-violet-200/90 bg-primary/10 border border-primary/30 rounded-xl px-3 py-2 leading-snug">
              {notice}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="text-[11px] text-red-200 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 leading-snug"
            >
              {error.message}
            </p>
          )}

          {/* ── Con sesión: `enterApp()` ya disparó la recarga ──────────────── */}
          {step === AUTH_STEP.DONE && (
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Entrando a Trucky...
            </div>
          )}

          {/* ── Confirmación de "olvidé mi contraseña" ─────────────────────── */}
          {step === AUTH_STEP.RESET_SENT && (
            <>
              <div className="bg-card border border-border rounded-xl p-4 flex flex-col items-center gap-2 text-center">
                <MailCheck className="w-6 h-6 text-primary" />
                <p className="text-xs text-muted-foreground leading-snug">
                  Si el correo está registrado, en unos minutos recibirás las instrucciones para
                  crear una contraseña nueva.
                </p>
              </div>
              <button
                type="button"
                onClick={() => dispatch({ type: 'back_to_credentials' })}
                className={PRIMARY_BUTTON_CLASS}
              >
                Volver a iniciar sesión
              </button>
            </>
          )}

          {/* ── Código de verificación ─────────────────────────────────────── */}
          {step === AUTH_STEP.OTP && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label htmlFor="otp" className="text-xs font-medium text-foreground">
                  Código de verificación
                </label>
                <input
                  id="otp"
                  name="otp"
                  value={otp}
                  onChange={(e) =>
                    dispatch({
                      type: 'set_field',
                      field: 'otp',
                      value: e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH),
                    })
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={OTP_LENGTH}
                  placeholder="123456"
                  disabled={busy}
                  autoFocus
                  className={`${INPUT_CLASS} tracking-[0.4em] text-center font-semibold`}
                />
              </div>
              <button type="submit" disabled={busy} className={PRIMARY_BUTTON_CLASS}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {busy ? 'Verificando...' : 'Verificar y entrar'}
              </button>
              <div className="flex items-center justify-between">
                <button type="button" onClick={handleResendOtp} disabled={busy} className={LINK_CLASS}>
                  Enviar un código nuevo
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'back_to_credentials' })}
                  disabled={busy}
                  className={`${LINK_CLASS} flex items-center gap-1`}
                >
                  <ArrowLeft className="w-3 h-3" />
                  Usar otro correo
                </button>
              </div>
            </form>
          )}

          {/* ── Correo y contraseña ────────────────────────────────────────── */}
          {step === AUTH_STEP.CREDENTIALS && (
            <>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label htmlFor="email" className="text-xs font-medium text-foreground">
                    Correo electrónico
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={setField('email')}
                    placeholder="tu@empresa.com"
                    autoComplete="email"
                    disabled={busy}
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="password" className="text-xs font-medium text-foreground">
                    Contraseña
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    value={password}
                    onChange={setField('password')}
                    placeholder={isRegister ? 'Al menos 8 caracteres' : '••••••••'}
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    disabled={busy}
                    className={INPUT_CLASS}
                  />
                </div>
                <button type="submit" disabled={busy} className={PRIMARY_BUTTON_CLASS}>
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  {busy
                    ? isRegister ? 'Creando cuenta...' : 'Entrando...'
                    : isRegister ? 'Crear cuenta' : 'Iniciar sesión'}
                </button>
              </form>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() =>
                    dispatch({ type: 'set_mode', mode: isRegister ? AUTH_MODE.LOGIN : AUTH_MODE.REGISTER })
                  }
                  disabled={busy}
                  className={LINK_CLASS}
                >
                  {isRegister ? 'Ya tengo cuenta' : 'Crear una cuenta'}
                </button>
                {!isRegister && (
                  <button type="button" onClick={handleForgotPassword} disabled={busy} className={LINK_CLASS}>
                    Olvidé mi contraseña
                  </button>
                )}
              </div>

              {/* Separador */}
              <div className="flex items-center gap-3 pt-1">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">o</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={busy}
                className="w-full py-3 rounded-xl bg-card border border-border hover:border-primary/50 hover:bg-primary/5 text-sm font-semibold text-foreground transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <GoogleMark />
                Continuar con Google
              </button>
            </>
          )}

          <p className="text-center text-[11px] text-muted-foreground">
            Al registrarte, se crea tu propio espacio de trabajo privado.<br />
            Tus datos nunca se mezclan con los de otras empresas.
          </p>
        </div>
      </div>
    </div>
  );
}
