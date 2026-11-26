import { useState } from 'react';
import { useLanguage } from '@/lib/LanguageContext';
import { TruckyWordmark } from '@/components/TruckyLogo';
import { base44 } from '@/api/base44Client';
import { deriveCosts, FIXED_COST_DEFAULTS } from '@/lib/freight/costMath';
import { Truck, Users, ChevronRight, ChevronLeft, CheckCircle2 } from 'lucide-react';

/**
 * Onboarding — v4
 * 4 pasos: Rol → Datos de negocio → Costos → Confirmación
 *
 * Onboarding solo recolecta diésel, MPG y % de pago al conductor — no pide
 * costos fijos (seguro/lease/otros gastos). Para no mentir con un fixedCpm
 * hardcodeado, el costo fijo usa FIXED_COST_DEFAULTS (la misma fuente que
 * src/lib/freight/costMath.js), y esos 4 campos se escriben en el registro
 * junto con los derivados — así la Calculadora recarga exactamente el mismo
 * número (ver M7/M11 en el walkthrough de la demo).
 */

const DEFAULT_COSTS = { diesel: 5.40, mpg: 6.5, conductor: 25 };

export default function Onboarding({ onComplete }) {
  // Inglés por defecto (idioma de la app); en español si el usuario lo eligió.
  const { locale } = useLanguage();
  const tx = (es, en) => (locale === 'es' ? es : en);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [setupError, setSetupError] = useState(false);
  const [linkRequired,setLinkRequired]=useState(false);

  // Paso 1
  const [rol, setRol] = useState(null);

  // Paso 2
  const [nombre, setNombre] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [mc, setMc] = useState('');

  // Paso 3
  const [diesel, setDiesel] = useState(DEFAULT_COSTS.diesel);
  const [mpg, setMpg] = useState(DEFAULT_COSTS.mpg);
  const [conductor, setConductor] = useState(DEFAULT_COSTS.conductor);

  // deriveCosts coerce sus inputs internamente (ver `num()` en costMath.js),
  // así que diesel/mpg/conductor pueden llegar como string (typeo de <input>)
  // o number (el estado inicial) sin necesidad de convertir acá.
  const costos = deriveCosts({
    diesel_precio: diesel,
    mpg,
    pago_conductor_porcentaje: conductor,
    ...FIXED_COST_DEFAULTS,
  });
  const breakEvenDisplay = costos.valido ? `$${costos.tarifaBreakEven.toFixed(2)}` : tx('sin calcular', 'not calculated');
  // Un % fuera de [0, 100) no se deja avanzar: se guardaría un costo sin sentido.
  const pctConductor = Number(String(conductor ?? '').replace(',', '.'));
  const pctInvalido = !(pctConductor >= 0 && pctConductor < 100);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const handleComplete = async () => {
    setLoading(true);
    setSetupError(false);
    setLinkRequired(false);
    const user = await base44.auth.me();

    // 1-2. Organización + membresía 'owner'
    // Se crean en el servidor (ensureUserOrganization): el cliente ya no puede
    // crear Organization ni OrganizationMember directamente, así nadie puede
    // fabricarse una suscripción de pago ni entrar a una organización ajena.
    let org = null;
    try {
      const res = await base44.functions.invoke('ensureUserOrganization', {
        company_name: empresa,
        account_type: rol,
      });
      if (!res?.data?.org_id) throw new Error(res?.data?.error || 'Sin organización');
      org = { id: res.data.org_id, name: res.data.name };
    } catch (err) {
      const code=err?.response?.data?.error||err?.message;
      setLinkRequired(code==='BILLING_IDENTITY_LINK_REQUIRED');
      console.error('[Onboarding] organization_setup_failed');
      setLoading(false);
      setSetupError(true);
      return;
    }

    // 3. UserProfile
    const existingProfiles = await base44.entities.UserProfile.filter({ usuario: user.email });
    // Idioma: el que el usuario tiene en pantalla (inglés por defecto), para que al
    // crearse el perfil no cambie solo al valor predeterminado de la base de datos.
    let idioma = 'en';
    try { idioma = localStorage.getItem('trucky_locale') === 'es' ? 'es' : 'en'; } catch { /* sin almacenamiento */ }
    const profileData = { usuario: user.email, rol, onboarding_completado: true, ...(existingProfiles[0]?.idioma_chat ? {} : { idioma_chat: idioma }) };
    if (existingProfiles.length > 0) {
      await base44.entities.UserProfile.update(existingProfiles[0].id, profileData);
    } else {
      await base44.entities.UserProfile.create(profileData);
    }

    // 4. CarrierProfile
    if (rol === 'carrier') {
      const existingCarriers = await base44.entities.CarrierProfile.filter({ organization_id: org.id });
      const carrierData = {
        organization_id: org.id,
        company_name:    empresa || user.full_name || 'Mi Empresa',
        mc_number:       mc || null,
        active:          true,
      };
      if (existingCarriers.length > 0) {
        await base44.entities.CarrierProfile.update(existingCarriers[0].id, carrierData);
      } else {
        await base44.entities.CarrierProfile.create(carrierData);
      }
    }

    // 5. DispatcherProfile
    if (rol === 'dispatcher') {
      const existingDisp = await base44.entities.DispatcherProfile.filter({ user_id: user.email });
      const dispData = {
        user_id:       user.email,
        dispatch_mode: 'single_carrier',
      };
      if (existingDisp.length > 0) {
        await base44.entities.DispatcherProfile.update(existingDisp[0].id, dispData);
      } else {
        await base44.entities.DispatcherProfile.create(dispData);
      }
    }

    // 6. CostConfig
    // Los 4 campos de costo fijo + los derivados solo se escriben cuando
    // costos.valido — un registro incompleto se queda "sin configurar" en
    // vez de guardar un costo_por_milla que no es finito (ver requerimiento
    // "Onboarding completion leaves a recognized cost-configuration state").
    const existingCosts = await base44.entities.CostConfig.filter({ usuario: user.email });
    const costData = {
      usuario:       user.email,
      organization_id: org.id,
      profile_id:    '1',
      diesel_precio: parseFloat(diesel),
      mpg:           parseFloat(mpg),
      pago_conductor_porcentaje: parseFloat(conductor),
      // QA 25-nov: el registro inicial deja la calculadora configurada (antes el chat
      // pedía configurarla aunque el usuario ya la había llenado aquí). Se guardan los
      // mismos costos fijos estimados con los que se mostró el break-even en este paso.
      ...FIXED_COST_DEFAULTS,
      ...(costos.valido ? { costo_por_milla: costos.costoPorMilla, tarifa_break_even: costos.tarifaBreakEven } : {}),
    };
    if (existingCosts.length > 0) {
      await base44.entities.CostConfig.update(existingCosts[0].id, costData);
    } else {
      await base44.entities.CostConfig.create(costData);
    }

    onComplete();
  };

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center z-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">{tx('Configurando tu espacio de trabajo...', 'Setting up your workspace...')}</p>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="w-full max-w-md my-8">

        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <TruckyWordmark imgClass="h-8" />
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 space-y-6">

          {/* Indicador de pasos */}
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map(n => (
              <div key={n} className="flex items-center flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  n < step ? 'bg-primary text-primary-foreground' :
                  n === step ? 'bg-primary/20 border border-primary text-t-text-accent' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {n < step ? '✓' : n}
                </div>
                {n < 4 && <div className={`flex-1 h-0.5 mx-1 transition-all ${n < step ? 'bg-primary' : 'bg-border'}`} />}
              </div>
            ))}
          </div>

          {/* ── PASO 1: Rol ──────────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-t-text-accent font-semibold uppercase tracking-wider">{tx('Paso 1 de 4', 'Step 1 of 4')}</p>
                <h2 className="text-lg font-bold text-foreground mt-1">{tx('¿Cuál es tu rol?', 'What is your role?')}</h2>
                <p className="text-sm text-muted-foreground mt-1">{tx('Esto personaliza el verificador de documentos y las herramientas de análisis.', 'This personalizes the document checker and the analysis tools.')}</p>
              </div>
              <div className="space-y-3">
                {[
                  {
                    value: 'carrier',
                    icon: Truck,
                    title: 'Carrier',
                    desc: tx('Opero mi propio camión o flota. El análisis se enfoca en rentabilidad y viabilidad operativa.', 'I run my own truck or fleet. The analysis focuses on profitability and operational viability.'),
                  },
                  {
                    value: 'dispatcher',
                    icon: Users,
                    title: 'Dispatcher',
                    desc: tx('Despacho para uno o varios carriers. El análisis verifica compatibilidad del documento con el carrier asignado.', 'I dispatch for one or more carriers. The analysis checks the document against the assigned carrier.'),
                  },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setRol(opt.value); setStep(2); }}
                    className="w-full flex items-center gap-4 p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 text-left transition-all group"
                  >
                    <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10 transition-colors">
                      <opt.icon className="w-6 h-6 text-muted-foreground group-hover:text-t-text-accent transition-colors" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-foreground">{opt.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{opt.desc}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-t-text-accent flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── PASO 2: Datos de negocio ─────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-t-text-accent font-semibold uppercase tracking-wider">{tx('Paso 2 de 4', 'Step 2 of 4')}</p>
                <h2 className="text-lg font-bold text-foreground mt-1">{tx('Datos de tu negocio', 'Your business details')}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {rol === 'carrier' ? tx('Información de tu empresa carrier.', 'Information about your carrier company.') : tx('Información de tu operación como dispatcher.', 'Information about your dispatch operation.')}
                </p>
              </div>

              <div className="space-y-3">
                {rol === 'carrier' ? (
                  <>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{tx('Nombre legal de la empresa *', 'Legal company name *')}</label>
                      <input
                        value={empresa}
                        onChange={e => setEmpresa(e.target.value)}
                        placeholder="ABC Trucking LLC"
                        className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{tx('MC Number (opcional)', 'MC Number (optional)')}</label>
                      <input
                        value={mc}
                        onChange={e => setMc(e.target.value)}
                        placeholder="MC-123456"
                        className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{tx('Tu nombre completo *', 'Your full name *')}</label>
                      <input
                        value={nombre}
                        onChange={e => setNombre(e.target.value)}
                        placeholder={tx('Juan Pérez', 'John Smith')}
                        className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{tx('Empresa con la que trabajas (opcional)', 'Company you work with (optional)')}</label>
                      <input
                        value={empresa}
                        onChange={e => setEmpresa(e.target.value)}
                        placeholder="ABC Trucking LLC"
                        className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={() => setStep(1)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
                  <ChevronLeft className="w-4 h-4" /> {tx('Atrás', 'Back')}
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={rol === 'carrier' ? !empresa.trim() : !nombre.trim()}
                  className="flex-1 py-2.5 rounded-full bg-primary hover:bg-t-action-primary-hover disabled:opacity-40 text-sm font-semibold text-primary-foreground flex items-center justify-center gap-2 transition-all"
                >
                  {tx('Continuar', 'Continue')} <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── PASO 3: Costos operativos ────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-t-text-accent font-semibold uppercase tracking-wider">{tx('Paso 3 de 4', 'Step 3 of 4')}</p>
                <h2 className="text-lg font-bold text-foreground mt-1">{tx('Costos operativos', 'Operating costs')}</h2>
                <p className="text-sm text-muted-foreground mt-1">{tx('Usados para calcular tu break-even y evaluar rentabilidad de cargas.', 'Used to calculate your break-even and evaluate load profitability.')}</p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{tx('Precio del diésel ($/gal)', 'Diesel price ($/gal)')}</label>
                  <input
                    type="number"
                    step="0.01"
                    value={diesel}
                    onChange={e => setDiesel(e.target.value)}
                    className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{tx('MPG del camión', 'Truck MPG')}</label>
                  <input
                    type="number"
                    step="0.1"
                    value={mpg}
                    onChange={e => setMpg(e.target.value)}
                    className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{tx('% de pago al conductor', 'Driver pay %')}</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="99"
                    value={conductor}
                    onChange={e => setConductor(e.target.value)}
                    className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  {pctInvalido && (
                    <p role="alert" className="mt-1 text-xs text-destructive">
                      {tx('El % de pago al conductor debe estar entre 0 y 99.', 'Driver pay % must be between 0 and 99.')}
                    </p>
                  )}
                </div>

                {/* Break-even en tiempo real */}
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-3.5">
                  <p className="text-xs text-muted-foreground">{tx('Break-even estimado', 'Estimated break-even')}</p>
                  <p className="text-2xl font-bold text-t-text-accent font-mono mt-0.5">
                    {breakEvenDisplay}
                    {costos.valido && <span className="text-sm font-normal text-muted-foreground">/mi</span>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{tx('Necesitas cobrar al menos esta tarifa por milla para cubrir costos.', 'You need to charge at least this rate per mile to cover costs.')}</p>
                  <p className="text-xs text-muted-foreground mt-1">{tx('Incluye una estimación de seguro, lease y otros gastos; ajústala en la Calculadora.', 'Includes an estimate for insurance, lease and other expenses; adjust it in the Calculator.')}</p>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={() => setStep(2)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
                  <ChevronLeft className="w-4 h-4" /> {tx('Atrás', 'Back')}
                </button>
                <button
                  onClick={() => setStep(4)}
                  disabled={pctInvalido}
                  className="flex-1 py-2.5 rounded-full bg-primary hover:bg-t-action-primary-hover text-sm font-semibold text-primary-foreground flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {tx('Continuar', 'Continue')} <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── PASO 4: Confirmación ─────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-t-text-accent font-semibold uppercase tracking-wider">{tx('Paso 4 de 4', 'Step 4 of 4')}</p>
                <h2 className="text-lg font-bold text-foreground mt-1">{tx('¡Listo para operar!', 'Ready to go!')}</h2>
                <p className="text-sm text-muted-foreground mt-1">{tx('Revisa tu configuración antes de entrar.', 'Review your setup before you start.')}</p>
              </div>

              <div className="bg-muted/50 rounded-xl divide-y divide-border/50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs text-muted-foreground">{tx('Rol', 'Role')}</span>
                  <span className="text-xs font-semibold text-foreground capitalize">{rol}</span>
                </div>
                {(empresa || nombre) && (
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-xs text-muted-foreground">{rol === 'carrier' ? tx('Empresa', 'Company') : tx('Nombre', 'Name')}</span>
                    <span className="text-xs font-semibold text-foreground">{rol === 'carrier' ? empresa : nombre}</span>
                  </div>
                )}
                {mc && (
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-xs text-muted-foreground">MC Number</span>
                    <span className="text-xs font-semibold text-foreground">{mc}</span>
                  </div>
                )}
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs text-muted-foreground">{tx('Diésel', 'Diesel')}</span>
                  <span className="text-xs font-semibold text-foreground">${diesel}/gal</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs text-muted-foreground">MPG</span>
                  <span className="text-xs font-semibold text-foreground">{mpg} mi/gal</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs text-muted-foreground">{tx('% Conductor', 'Driver %')}</span>
                  <span className="text-xs font-semibold text-foreground">{conductor}%</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-primary/5">
                  <span className="text-xs text-t-text-accent font-medium">Break-even</span>
                  <span className="text-xs font-bold text-t-text-accent font-mono">
                    {breakEvenDisplay}{costos.valido && '/mi'}
                  </span>
                </div>
              </div>

              {linkRequired && <div role="alert" className="text-sm rounded-xl border border-primary p-4"><strong>{tx('Confirma tu cuenta', 'Confirm your account')}</strong><p>{tx('La empresa ya existe. Vincula tu cuenta de Trucky con Google antes de continuar; no crees otra empresa.', 'The company already exists. Link your Trucky account with Google before continuing; do not create another company.')}</p><a href="https://www.trucky-ai.com/billing-link" target="_blank" rel="noopener noreferrer" className="text-t-text-accent underline">{tx('Confirmar mi cuenta', 'Confirm my account')}</a></div>}
              {setupError && !linkRequired && (
                <p role="alert" className="text-xs text-destructive">
                  {tx('No pudimos crear tu organización. Revisa tu conexión e inténtalo de nuevo.', 'We could not create your organization. Check your connection and try again.')}
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <button onClick={() => setStep(3)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
                  <ChevronLeft className="w-4 h-4" /> {tx('Atrás', 'Back')}
                </button>
                <button
                  onClick={handleComplete}
                  className="flex-1 py-2.5 rounded-full bg-primary hover:bg-t-action-primary-hover text-sm font-semibold text-primary-foreground flex items-center justify-center gap-2 transition-all"
                >
                  <CheckCircle2 className="w-4 h-4" /> {tx('Entrar a Trucky', 'Enter Trucky')}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}