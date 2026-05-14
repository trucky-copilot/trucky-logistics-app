/**
 * Go-Live Checklist Engine  v2
 * ─────────────────────────────
 * Dos capas de validación:
 *
 * 1. production_access  → ¿puede el usuario entrar a la app?
 *    Requisito único: UserProfile con onboarding_completado === true.
 *    Si no existe o es false → appState = 'setup'.
 *
 * 2. operational_readiness → avisos no bloqueantes en el UI.
 *    Estados: 'basic' | 'partial' | 'ready'
 *
 * CAMBIOS v2:
 * - La decisión de bloqueo es SOLO UserProfile.onboarding_completado.
 * - CarrierProfile se filtra por organization_id (nunca global).
 * - No se hace upsert en GoLiveChecklist en cada carga — solo cuando
 *   se llama explícitamente desde el onboarding.
 */

import { base44 } from '@/api/base44Client';

/** Etiquetas legibles para cada ítem del checklist */
export const CHECKLIST_LABELS = {
  organization:       'Crear y activar la organización',
  rol:                'Elegir rol (carrier / dispatcher)',
  onboarding:         'Completar el proceso de onboarding',
  carrier_profile:    'Completar perfil del carrier (nombre legal + MC Number)',
  dispatcher_profile: 'Crear perfil de dispatcher',
  cost_config:        'Configurar costos de operación (diesel, MPG)',
};

/** Mensajes de aviso para cada ítem de operational readiness faltante */
export const READINESS_MESSAGES = {
  carrier_profile:    'Falta completar el perfil operativo del carrier (nombre legal + MC Number).',
  dispatcher_profile: 'Falta crear el perfil de dispatcher.',
  cost_config:        'Completa tu configuración de costos para recomendaciones más precisas.',
};

/**
 * Evalúa el workspace del usuario y devuelve el resultado.
 * NO persiste en GoLiveChecklist — eso solo lo hace persistChecklist().
 *
 * @param {object} user  — objeto de base44.auth.me()
 * @returns {object}  { ready, profile, organization, operationalReadiness, missingOptional }
 */
export async function evaluateChecklist(user) {
  const email = user.email;

  // 1. Cargar UserProfile + membresía en paralelo
  const [profiles, members] = await Promise.all([
    base44.entities.UserProfile.filter({ usuario: email }),
    base44.entities.OrganizationMember.filter({ user_email: email, active: true }),
  ]);

  const profile    = profiles[0] || null;
  const membership = members[0]  || null;

  // 2. Resolver organización activa
  let organization = null;
  if (membership?.organization_id) {
    const orgs = await base44.entities.Organization.filter({ id: membership.organization_id });
    organization = orgs[0] || null;
  }

  // ── Capa 1: production_access ─────────────────────────────────────────────
  // Único requisito: haber completado el onboarding.
  const ready = !!(profile?.onboarding_completado);

  if (!ready) {
    return { ready, profile, organization, membership, operationalReadiness: 'basic', missingOptional: [] };
  }

  // ── Capa 2: operational_readiness (solo si ya está en producción) ──────────
  const rol = profile?.rol;
  const needsCarrier    = rol === 'carrier'    || rol === 'ambos';
  const needsDispatcher = rol === 'dispatcher' || rol === 'ambos';
  const orgId = organization?.id || null;

  // Cargar solo lo necesario para readiness, filtrando por organización
  const [costConfigs, carrierProfiles, dispatcherProfiles] = await Promise.all([
    needsCarrier    ? base44.entities.CostConfig.filter({ usuario: email })                          : Promise.resolve([]),
    needsCarrier    ? base44.entities.CarrierProfile.filter({ organization_id: orgId, active: true }) : Promise.resolve([]),
    needsDispatcher ? base44.entities.DispatcherProfile.filter({ user_id: email })                   : Promise.resolve([]),
  ]);

  const costConfig     = costConfigs[0]     || null;
  const carrierProfile = carrierProfiles[0] || null;
  const dispProfile    = dispatcherProfiles[0] || null;

  const missingOptional = [];
  if (needsCarrier    && !(carrierProfile?.company_name && carrierProfile?.mc_number)) missingOptional.push('carrier_profile');
  if (needsDispatcher && !dispProfile?.user_id)                                        missingOptional.push('dispatcher_profile');
  if (needsCarrier    && !(costConfig?.diesel_precio && costConfig?.mpg))               missingOptional.push('cost_config');

  const operationalReadiness = missingOptional.length === 0 ? 'ready'
    : missingOptional.length === 1 ? 'partial'
    : 'basic';

  return {
    ready,
    profile,
    organization,
    membership,
    operationalReadiness,
    missingOptional,
    // raw — para quien lo necesite
    carrierProfile,
    dispProfile,
    costConfig,
  };
}

/**
 * Persiste el resultado en GoLiveChecklist (upsert).
 * Llamar SOLO desde el onboarding, no en cada carga de app.
 */
export async function persistChecklist(user, evalResult) {
  const email = user.email;
  const { profile, organization, operationalReadiness, missingOptional, ready } = evalResult;

  const overall_status = ready
    ? (operationalReadiness === 'ready' ? 'ready_for_production' : 'partially_ready')
    : 'not_ready';

  const checklistData = {
    organization_id:          organization?.id || null,
    user_email:               email,
    role_selected:            !!(profile?.rol),
    onboarding_ready:         !!(profile?.onboarding_completado),
    carrier_profile_ready:    !missingOptional.includes('carrier_profile'),
    dispatcher_profile_ready: !missingOptional.includes('dispatcher_profile'),
    cost_config_ready:        !missingOptional.includes('cost_config'),
    organization_ready:       !!(organization?.active),
    production_ready:         ready,
    overall_status,
    missing_items:            missingOptional,
    evaluated_at:             new Date().toISOString(),
  };

  const existing = await base44.entities.GoLiveChecklist.filter({ user_email: email });
  if (existing.length > 0) {
    await base44.entities.GoLiveChecklist.update(existing[0].id, checklistData);
  } else {
    await base44.entities.GoLiveChecklist.create(checklistData);
  }
}

// Mantener compatibilidad con código existente que llame evaluateAndPersistChecklist
export async function evaluateAndPersistChecklist(user) {
  const result = await evaluateChecklist(user);
  // Solo persiste si ya completó onboarding (evita writes innecesarios en usuarios nuevos)
  if (result.ready) {
    await persistChecklist(user, result).catch(() => {});
  }
  return {
    ready:                result.ready,
    missing:              result.ready ? [] : ['onboarding'],
    overall_status:       result.operationalReadiness,
    operational_readiness: result.operationalReadiness,
    missing_optional:     result.missingOptional,
    checklist:            null,
    organization:         result.organization,
    profile:              result.profile,
    membership:           result.membership,
    carrierProfile:       result.carrierProfile || null,
    dispProfile:          result.dispProfile || null,
    costConfig:           result.costConfig || null,
  };
}