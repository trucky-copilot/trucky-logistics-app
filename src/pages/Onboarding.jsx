import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Truck, Users, ChevronRight, ChevronLeft, CheckCircle2 } from 'lucide-react';

/**
 * Onboarding — v4
 * 4 pasos: Rol → Datos de negocio → Costos → Confirmación
 */

const DEFAULT_COSTS = { diesel: 5.40, mpg: 6.5, conductor: 25 };

function calcBreakEven(diesel, mpg, conductorPct) {
  const fuelCpm = parseFloat(diesel) / parseFloat(mpg);
  const fixedCpm = 0.45; // seguro + lease estimado por milla
  const baseCpm = fuelCpm + fixedCpm;
  const total = baseCpm / (1 - parseFloat(conductorPct) / 100);
  return isNaN(total) ? 0 : total.toFixed(2);
}

export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

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

  const breakEven = calcBreakEven(diesel, mpg, conductor);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const handleComplete = async () => {
    setLoading(true);
    const user = await base44.auth.me();

    // 1. Organización
    let org = null;
    const existingOrgs = await base44.entities.Organization.filter({ created_by_user: user.email });
    if (existingOrgs.length > 0) {
      org = existingOrgs[0];
    } else {
      org = await base44.entities.Organization.create({
        name:                 empresa || user.full_name || user.email,
        created_by_user:      user.email,
        workspace_status:     'production',
        onboarding_completed: true,
        production_ready:     true,
        active:               true,
      });
    }

    // 2. OrganizationMember
    const existingMembers = await base44.entities.OrganizationMember.filter({ organization_id: org.id, user_email: user.email });
    if (existingMembers.length === 0) {
      await base44.entities.OrganizationMember.create({
        organization_id: org.id,
        user_email:      user.email,
        role:            'owner',
        active:          true,
      });
    }

    // 3. UserProfile
    const existingProfiles = await base44.entities.UserProfile.filter({ usuario: user.email });
    const profileData = { usuario: user.email, rol, onboarding_completado: true };
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
    const existingCosts = await base44.entities.CostConfig.filter({ usuario: user.email });
    const costData = {
      usuario:       user.email,
      organization_id: org.id,
      diesel_precio: parseFloat(diesel),
      mpg:           parseFloat(mpg),
      pago_conductor_porcentaje: parseFloat(conductor),
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
          <p className="text-sm text-muted-foreground">Configurando tu espacio de trabajo...</p>
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
          <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
            <img
              src="https://media.base44.com/images/public/69e8214a181314e517a283d5/ef839c541_LARCOFERLOGO.png"
              alt="Larcofer Logo"
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <div className="text-lg font-bold text-foreground tracking-wide">TRUCKY</div>
            <div className="text-xs text-muted-foreground font-medium">LARCOFER USA</div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 space-y-6">

          {/* Indicador de pasos */}
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map(n => (
              <div key={n} className="flex items-center flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  n < step ? 'bg-primary text-primary-foreground' :
                  n === step ? 'bg-primary/20 border border-primary text-primary' :
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
                <p className="text-xs text-primary font-semibold uppercase tracking-wider">Paso 1 de 4</p>
                <h2 className="text-lg font-bold text-foreground mt-1">¿Cuál es tu rol?</h2>
                <p className="text-sm text-muted-foreground mt-1">Esto personaliza el verificador de documentos y las herramientas de análisis.</p>
              </div>
              <div className="space-y-3">
                {[
                  {
                    value: 'carrier',
                    icon: Truck,
                    title: 'Carrier',
                    desc: 'Opero mi propio camión o flota. El análisis se enfoca en rentabilidad y viabilidad operativa.',
                  },
                  {
                    value: 'dispatcher',
                    icon: Users,
                    title: 'Dispatcher',
                    desc: 'Despacho para uno o varios carriers. El análisis verifica compatibilidad del documento con el carrier asignado.',
                  },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setRol(opt.value); setStep(2); }}
                    className="w-full flex items-center gap-4 p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 text-left transition-all group"
                  >
                    <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10 transition-colors">
                      <opt.icon className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-foreground">{opt.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{opt.desc}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── PASO 2: Datos de negocio ─────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-primary font-semibold uppercase tracking-wider">Paso 2 de 4</p>
                <h2 className="text-lg font-bold text-foreground mt-1">Datos de tu negocio</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {rol === 'carrier' ? 'Información de tu empresa carrier.' : 'Información de tu operación como dispatcher.'}
                </p>
              </div>

              <div className="space-y-3">
                {rol === 'carrier' ? (
                  <>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nombre legal de la empresa *</label>
                      <input
                        value={empresa}
                        onChange={e => setEmpresa(e.target.value)}
                        placeholder="ABC Trucking LLC"
                        className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">MC Number (opcional)</label>
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
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tu nombre completo *</label>
                      <input
                        value={nombre}
                        onChange={e => setNombre(e.target.value)}
                        placeholder="Juan Pérez"
                        className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Empresa con la que trabajas (opcional)</label>
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
                  <ChevronLeft className="w-4 h-4" /> Atrás
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={rol === 'carrier' ? !empresa.trim() : !nombre.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-40 text-sm font-semibold text-primary-foreground flex items-center justify-center gap-2 transition-all"
                >
                  Continuar <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── PASO 3: Costos operativos ────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-primary font-semibold uppercase tracking-wider">Paso 3 de 4</p>
                <h2 className="text-lg font-bold text-foreground mt-1">Costos operativos</h2>
                <p className="text-sm text-muted-foreground mt-1">Usados para calcular tu break-even y evaluar rentabilidad de cargas.</p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Precio del diésel ($/gal)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={diesel}
                    onChange={e => setDiesel(e.target.value)}
                    className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">MPG del camión</label>
                  <input
                    type="number"
                    step="0.1"
                    value={mpg}
                    onChange={e => setMpg(e.target.value)}
                    className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">% de pago al conductor</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={conductor}
                    onChange={e => setConductor(e.target.value)}
                    className="mt-1 w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>

                {/* Break-even en tiempo real */}
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-3.5">
                  <p className="text-xs text-muted-foreground">Break-even estimado</p>
                  <p className="text-2xl font-bold text-primary font-mono mt-0.5">${breakEven}<span className="text-sm font-normal text-muted-foreground">/mi</span></p>
                  <p className="text-xs text-muted-foreground mt-1">Necesitas cobrar al menos esta tarifa por milla para cubrir costos.</p>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={() => setStep(2)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
                  <ChevronLeft className="w-4 h-4" /> Atrás
                </button>
                <button
                  onClick={() => setStep(4)}
                  className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-sm font-semibold text-primary-foreground flex items-center justify-center gap-2 transition-all"
                >
                  Continuar <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── PASO 4: Confirmación ─────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-primary font-semibold uppercase tracking-wider">Paso 4 de 4</p>
                <h2 className="text-lg font-bold text-foreground mt-1">¡Listo para operar!</h2>
                <p className="text-sm text-muted-foreground mt-1">Revisa tu configuración antes de entrar.</p>
              </div>

              <div className="bg-muted/50 rounded-xl divide-y divide-border/50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs text-muted-foreground">Rol</span>
                  <span className="text-xs font-semibold text-foreground capitalize">{rol}</span>
                </div>
                {(empresa || nombre) && (
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-xs text-muted-foreground">{rol === 'carrier' ? 'Empresa' : 'Nombre'}</span>
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
                  <span className="text-xs text-muted-foreground">Diésel</span>
                  <span className="text-xs font-semibold text-foreground">${diesel}/gal</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs text-muted-foreground">MPG</span>
                  <span className="text-xs font-semibold text-foreground">{mpg} mi/gal</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs text-muted-foreground">% Conductor</span>
                  <span className="text-xs font-semibold text-foreground">{conductor}%</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-primary/5">
                  <span className="text-xs text-primary font-medium">Break-even</span>
                  <span className="text-xs font-bold text-primary font-mono">${breakEven}/mi</span>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={() => setStep(3)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
                  <ChevronLeft className="w-4 h-4" /> Atrás
                </button>
                <button
                  onClick={handleComplete}
                  className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-sm font-semibold text-primary-foreground flex items-center justify-center gap-2 transition-all"
                >
                  <CheckCircle2 className="w-4 h-4" /> Entrar a Trucky
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}