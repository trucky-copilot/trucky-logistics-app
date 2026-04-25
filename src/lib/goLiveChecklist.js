/**
 * Go-Live Checklist Engine
 * ────────────────────────
 * Evalúa el estado de activación de un workspace y persiste el resultado
 * en la entidad GoLiveChecklist. Es la fuente de verdad para AppStateContext.
 */

import { base44 } from '@/api/base44Client';

/** Etiquetas legibles para cada ítem faltante */
export const CHECKLIST_LABELS = {
  organization:         'Crear y activar la organización',
  rol:                  'Elegir rol (carrier / dispatcher)',
  onboarding:           'Completar el proceso de onboarding',
  carrier_profile:      'Completar perfil del carrier (nombre legal + MC Number)',
  dispatcher_profile:   'Crear perfil de dispatcher',
  cost_config:          'Configurar costos de operación (diesel, MPG)',
  production_ready:     'Marcar el workspace como listo para producción',
};

/**
 * Calcula overall_status a partir de los ítems faltantes.
 * @param {string[]} missing
 * @returns {'not_ready' | 'partially_ready' | 'ready_for_production'}
 */
function calcOverallStatus(missing) {
  if (missing.length === 0) return 'ready_for_production';
  // Si solo falta production_ready pero todo lo demás está OK → parcialmente listo
  if (missing.length === 1 && missing[0] === 'production_ready') return 'partially_ready';
  // Si falta solo cosas opcionales según el rol → parcialmente listo
  const criticals = ['organization', 'rol', 'onboarding'];
  const hasCritical = missing.some(m => criticals.includes(m));
  return hasCritical ? 'not_ready' : 'partially_ready';
}

/**
 * Evalúa el workspace del usuario, persiste el checklist y devuelve el resultado.
 * @param {object} user  — objeto de base44.auth.me()
 * @returns {object}     — { ready, missing, checklist, organization, profile, ... }
 */
export async function evaluateAndPersistChecklist(user) {
  const email = user.email;

  // Cargar todo en paralelo
  const [profiles, members, costConfigs, carrierProfiles, dispatcherProfiles] = await Promise.all([
    base44.entities.UserProfile.filter({ usuario: email }),
    base44.entities.OrganizationMember.filter({ user_email: email, active: true }),
    base44.entities.CostConfig.filter({ usuario: email }),
    base44.entities.CarrierProfile.filter({ active: true }),
    base44.entities.DispatcherProfile.filter({ user_id: email }),
  ]);

  const profile        = profiles[0]          || null;
  const membership     = members[0]           || null;
  const costConfig     = costConfigs[0]       || null;
  const carrierProfile = carrierProfiles[0]   || null;
  const dispProfile    = dispatcherProfiles[0] || null;

  // Resolver organización activa
  let organization = null;
  if (membership?.organization_id) {
    const orgs = await base44.entities.Organization.filter({ id: membership.organization_id });
    organization = orgs[0] || null;
  }

  // ── Evaluar cada ítem ────────────────────────────────────────────────────────
  const organization_ready   = !!(organization?.active);
  const role_selected        = !!(profile?.rol);
  const onboarding_ready     = !!(profile?.onboarding_completado);

  const needsCarrier    = profile?.rol === 'carrier'    || profile?.rol === 'ambos';
  const needsDispatcher = profile?.rol === 'dispatcher' || profile?.rol === 'ambos';

  const carrier_profile_ready    = needsCarrier
    ? !!(carrierProfile?.company_name && carrierProfile?.mc_number)
    : true; // no aplica → no bloquea

  const dispatcher_profile_ready = needsDispatcher
    ? !!(dispProfile?.user_id)
    : true; // no aplica → no bloquea

  const cost_config_ready = needsCarrier
    ? !!(costConfig?.diesel_precio && costConfig?.mpg)
    : true; // no aplica → no bloquea

  const production_ready_flag = !!(organization?.production_ready);

  // ── Construir lista de faltantes ─────────────────────────────────────────────
  const missing = [];
  if (!organization_ready)        missing.push('organization');
  if (!role_selected)             missing.push('rol');
  if (!onboarding_ready)          missing.push('onboarding');
  if (needsCarrier    && !carrier_profile_ready)    missing.push('carrier_profile');
  if (needsDispatcher && !dispatcher_profile_ready) missing.push('dispatcher_profile');
  if (needsCarrier    && !cost_config_ready)        missing.push('cost_config');
  if (!production_ready_flag)     missing.push('production_ready');

  const overall_status = calcOverallStatus(missing);
  const ready          = overall_status === 'ready_for_production';

  // ── Persistir en GoLiveChecklist (upsert por user_email) ────────────────────
  const checklistData = {
    organization_id:          organization?.id || null,
    user_email:               email,
    role_selected,
    onboarding_ready,
    carrier_profile_ready,
    dispatcher_profile_ready,
    cost_config_ready,
    organization_ready,
    production_ready:         production_ready_flag,
    overall_status,
    missing_items:            missing,
    evaluated_at:             new Date().toISOString(),
  };

  // Buscar registro existente para hacer update en lugar de crear duplicado
  const existing = await base44.entities.GoLiveChecklist.filter({ user_email: email });
  if (existing.length > 0) {
    await base44.entities.GoLiveChecklist.update(existing[0].id, checklistData);
  } else {
    await base44.entities.GoLiveChecklist.create(checklistData);
  }

  return {
    ready,
    missing,
    overall_status,
    checklist: checklistData,
    organization,
    profile,
    membership,
    carrierProfile,
    dispProfile,
    costConfig,
  };
}