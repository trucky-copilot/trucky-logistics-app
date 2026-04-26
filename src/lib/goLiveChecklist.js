/**
 * Go-Live Checklist Engine
 * ────────────────────────
 * Dos capas de validación:
 *
 * 1. production_access  → ¿puede el usuario entrar a la app?
 *    Requisitos: organization + rol + onboarding completado.
 *    Si falta alguno → appState = 'setup' (bloquea la app).
 *
 * 2. operational_readiness → ¿tiene todo para usar Trucky con datos reales?
 *    Estados: 'basic' | 'partial' | 'ready'
 *    No bloquea la app, pero genera avisos en el UI.
 *    Revisa: CarrierProfile completo, DispatcherProfile, CostConfig.
 */

import { base44 } from '@/api/base44Client';

/** Etiquetas legibles para cada ítem del checklist */
export const CHECKLIST_LABELS = {
  organization:         'Crear y activar la organización',
  rol:                  'Elegir rol (carrier / dispatcher)',
  onboarding:           'Completar el proceso de onboarding',
  carrier_profile:      'Completar perfil del carrier (nombre legal + MC Number)',
  dispatcher_profile:   'Crear perfil de dispatcher',
  cost_config:          'Configurar costos de operación (diesel, MPG)',
};

/** Mensajes de aviso para cada ítem de operational readiness faltante */
export const READINESS_MESSAGES = {
  carrier_profile:    'Falta completar el perfil operativo del carrier (nombre legal + MC Number).',
  dispatcher_profile: 'Falta crear el perfil de dispatcher.',
  cost_config:        'Completa tu configuración de costos para recomendaciones más precisas.',
};

/**
 * Calcula el production_access: ¿puede el usuario entrar a la app?
 * Solo depende de los 3 requisitos bloqueantes.
 */
function calcProductionAccess(missing_blocking) {
  return missing_blocking.length === 0;
}

/**
 * Calcula operational_readiness a partir de los ítems opcionales faltantes.
 * @param {string[]} missing_optional  — ítems de readiness que faltan
 * @returns {'basic' | 'partial' | 'ready'}
 */
function calcOperationalReadiness(missing_optional) {
  if (missing_optional.length === 0) return 'ready';
  if (missing_optional.length === 1) return 'partial';
  return 'basic';
}

/**
 * Evalúa el workspace del usuario, persiste el checklist y devuelve el resultado.
 * @param {object} user  — objeto de base44.auth.me()
 * @returns {object}
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

  const profile        = profiles[0]           || null;
  const membership     = members[0]            || null;
  const costConfig     = costConfigs[0]        || null;
  const carrierProfile = carrierProfiles[0]    || null;
  const dispProfile    = dispatcherProfiles[0] || null;

  // Resolver organización activa
  let organization = null;
  if (membership?.organization_id) {
    const orgs = await base44.entities.Organization.filter({ id: membership.organization_id });
    organization = orgs[0] || null;
  }

  // ── Capa 1: production_access (bloqueante) ───────────────────────────────────
  const organization_ready = !!(organization?.active);
  const role_selected      = !!(profile?.rol);
  const onboarding_ready   = !!(profile?.onboarding_completado);

  const missing_blocking = [];
  if (!organization_ready) missing_blocking.push('organization');
  if (!role_selected)      missing_blocking.push('rol');
  if (!onboarding_ready)   missing_blocking.push('onboarding');

  const production_access = calcProductionAccess(missing_blocking);

  // ── Capa 2: operational_readiness (no bloqueante) ────────────────────────────
  const needsCarrier    = profile?.rol === 'carrier'    || profile?.rol === 'ambos';
  const needsDispatcher = profile?.rol === 'dispatcher' || profile?.rol === 'ambos';

  const carrier_profile_ready    = needsCarrier
    ? !!(carrierProfile?.company_name && carrierProfile?.mc_number)
    : true;

  const dispatcher_profile_ready = needsDispatcher
    ? !!(dispProfile?.user_id)
    : true;

  const cost_config_ready = needsCarrier
    ? !!(costConfig?.diesel_precio && costConfig?.mpg)
    : true;

  const missing_optional = [];
  if (needsCarrier    && !carrier_profile_ready)    missing_optional.push('carrier_profile');
  if (needsDispatcher && !dispatcher_profile_ready) missing_optional.push('dispatcher_profile');
  if (needsCarrier    && !cost_config_ready)        missing_optional.push('cost_config');

  const operational_readiness = calcOperationalReadiness(missing_optional);

  // ── missing total (para GoLiveChecklist en DB) ───────────────────────────────
  const missing_all = [...missing_blocking, ...missing_optional];
  const overall_status = production_access
    ? (operational_readiness === 'ready' ? 'ready_for_production' : 'partially_ready')
    : 'not_ready';

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
    production_ready:         production_access,
    overall_status,
    missing_items:            missing_all,
    evaluated_at:             new Date().toISOString(),
  };

  const existing = await base44.entities.GoLiveChecklist.filter({ user_email: email });
  if (existing.length > 0) {
    await base44.entities.GoLiveChecklist.update(existing[0].id, checklistData);
  } else {
    await base44.entities.GoLiveChecklist.create(checklistData);
  }

  return {
    // Capa 1
    ready: production_access,          // ← controla setup vs production en AppState
    missing: missing_blocking,         // ← solo los bloqueantes para la pantalla de setup
    overall_status,
    // Capa 2
    operational_readiness,             // 'basic' | 'partial' | 'ready'
    missing_optional,                  // ítems de readiness faltantes (para avisos)
    // Raw data
    checklist: checklistData,
    organization,
    profile,
    membership,
    carrierProfile,
    dispProfile,
    costConfig,
  };
}