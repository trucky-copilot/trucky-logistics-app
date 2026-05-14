import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { evaluateChecklist, persistChecklist } from '@/lib/goLiveChecklist';
import { Truck, Users } from 'lucide-react';
import OnboardingCarrier from '@/components/onboarding/OnboardingCarrier';
import OnboardingDispatcher from '@/components/onboarding/OnboardingDispatcher';
import GoLiveChecklistPanel from '@/components/GoLiveChecklistPanel';

export default function Onboarding({ onComplete, setupDetails }) {
  const [rol, setRol] = useState(null);   // 'carrier' | 'dispatcher'
  const [loading, setLoading] = useState(false);

  const createOrganization = async (user, companyName) => {
    // Verificar si ya pertenece a una organización
    const existingMembers = await base44.entities.OrganizationMember.filter({ user_email: user.email, active: true });
    if (existingMembers.length > 0) {
      const orgs = await base44.entities.Organization.filter({ id: existingMembers[0].organization_id });
      return orgs[0] || null;
    }
    // Crear organización nueva
    const org = await base44.entities.Organization.create({
      name: companyName || `${user.full_name || user.email}'s Organization`,
      created_by_user: user.email,
      workspace_status: 'setup',
      onboarding_completed: false,
      production_ready: false,
      active: true,
    });
    // Crear membresía owner
    await base44.entities.OrganizationMember.create({
      organization_id: org.id,
      user_email: user.email,
      role: 'owner',
      active: true,
    });
    return org;
  };

  const handleCarrierComplete = async (data) => {
    setLoading(true);
    const user = await base44.auth.me();

    // Crear organización si no existe
    const org = await createOrganization(user, data.company_name);

    // Guardar UserProfile
    await base44.entities.UserProfile.create({
      usuario: user.email,
      rol: 'carrier',
      cantidad_camiones: '1',
      onboarding_completado: true,
    });

    // Guardar CarrierProfile
    const carrierProfile = await base44.entities.CarrierProfile.create({
      organization_id: org?.id || null,
      company_name: data.company_name,
      trade_name: data.trade_name || null,
      mc_number: data.mc_number || null,
      dot_number: data.dot_number || null,
      ports_operated: data.ports_operated || [],
      equipment_types: data.equipment_types || [],
      chassis_types: data.chassis_types || [],
      hazmat_allowed: data.hazmat_allowed,
      overweight_allowed: data.overweight_allowed,
      reefer_allowed: data.reefer_allowed,
      power_only_allowed: data.power_only_allowed,
      commodity_restrictions: data.commodity_restrictions
        ? data.commodity_restrictions.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      twic_required: data.twic_required,
      active: true,
    });

    // Guardar DispatcherProfile vinculado al carrier (para resolución en el analizador)
    await base44.entities.DispatcherProfile.create({
      user_id: user.email,
      dispatch_mode: 'single_carrier',
      default_carrier: carrierProfile.id,
      managed_carriers: [carrierProfile.id],
      service_lanes: data.lanes || [],
      preferred_brokers: [],
    });

    // Persistir checklist en DB (solo aquí, no en cada carga)
    const evalResult = await evaluateChecklist(user);
    await persistChecklist(user, evalResult).catch(() => {});

    onComplete();
  };

  const handleDispatcherComplete = async (data) => {
    setLoading(true);
    const user = await base44.auth.me();

    // Crear organización si no existe
    const firstCarrierName = data.carriers?.[0]?.company_name;
    const org = await createOrganization(user, firstCarrierName);

    // Guardar UserProfile
    await base44.entities.UserProfile.create({
      usuario: user.email,
      rol: 'dispatcher',
      cantidad_camiones: data.carriers?.length > 1 ? `${data.carriers.length}+` : '1',
      onboarding_completado: true,
    });

    // Guardar CarrierProfiles gestionados
    const carrierIds = [];
    for (const c of (data.carriers || [])) {
      if (!c.company_name?.trim()) continue;
      const created = await base44.entities.CarrierProfile.create({
        organization_id: org?.id || null,
        company_name: c.company_name,
        mc_number: c.mc_number || null,
        dot_number: c.dot_number || null,
        equipment_types: c.equipment_types || [],
        chassis_types: c.chassis_types || [],
        ports_operated: c.ports_operated || [],
        hazmat_allowed: c.hazmat_allowed || false,
        overweight_allowed: c.overweight_allowed || false,
        reefer_allowed: c.reefer_allowed || false,
        power_only_allowed: c.power_only_allowed || false,
        commodity_restrictions: c.commodity_restrictions
          ? c.commodity_restrictions.split(',').map(s => s.trim()).filter(Boolean)
          : [],
        twic_required: true,
        active: true,
      });
      carrierIds.push(created.id);
    }

    // Guardar DispatcherProfile
    await base44.entities.DispatcherProfile.create({
      user_id: user.email,
      dispatch_mode: data.dispatch_mode || 'single_carrier',
      default_carrier: carrierIds[0] || null,
      managed_carriers: carrierIds,
      service_lanes: data.lanes || [],
      preferred_brokers: data.brokers_frecuentes
        ? data.brokers_frecuentes.split(',').map(s => s.trim()).filter(Boolean)
        : [],
    });

    // Persistir checklist en DB (solo aquí, no en cada carga)
    const evalResult = await evaluateChecklist(user);
    await persistChecklist(user, evalResult).catch(() => {});

    onComplete();
  };

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

        {/* Checklist de activación — visible mientras el workspace no esté listo */}
        {setupDetails && (
          <div className="mb-4">
            <GoLiveChecklistPanel setupDetails={setupDetails} />
          </div>
        )}

        <div className="bg-card border border-border rounded-2xl p-6">
          {/* Paso inicial: elegir rol */}
          {!rol && (
            <div className="space-y-5">
              <div>
                <p className="text-xs text-primary font-semibold uppercase tracking-wider mb-1">Bienvenido</p>
                <h2 className="text-lg font-bold text-foreground">¿Cuál es tu rol en la operación?</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Esto personaliza el verificador de documentos y las herramientas de análisis.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => setRol('carrier')}
                  className="w-full flex items-center gap-3 p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 text-left transition-all group"
                >
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10 transition-colors">
                    <Truck className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-foreground">Carrier</div>
                    <div className="text-xs text-muted-foreground">Opero mi propio camión o flota. El análisis se enfoca en rentabilidad y viabilidad operativa.</div>
                  </div>
                </button>

                <button
                  onClick={() => setRol('dispatcher')}
                  className="w-full flex items-center gap-3 p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 text-left transition-all group"
                >
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10 transition-colors">
                    <Users className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-foreground">Dispatcher</div>
                    <div className="text-xs text-muted-foreground">Despacho para uno o varios carriers. El análisis verifica compatibilidad del documento con el carrier asignado.</div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Flujo Carrier */}
          {rol === 'carrier' && (
            <OnboardingCarrier
              onComplete={handleCarrierComplete}
              onBack={() => setRol(null)}
            />
          )}

          {/* Flujo Dispatcher */}
          {rol === 'dispatcher' && (
            <OnboardingDispatcher
              onComplete={handleDispatcherComplete}
              onBack={() => setRol(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}