// ─────────────────────────────────────────────────────────────────────────────
// Puerta de acceso por plan, resuelta en el SERVIDOR.
// La interfaz calcula el plan para pintar pantallas, pero eso no protege nada:
// cualquiera con su token puede invocar la función directamente. Aquí se aplica
// la misma regla desde la identidad de auth.me(), antes de gastar IA o correo.
// ─────────────────────────────────────────────────────────────────────────────

export type PlanType = 'admin' | 'plan_99' | 'plan_29' | 'demo';

export type PlanFeature = 'chat' | 'document_analysis' | 'email_module';

export type DenialCode = 'TRIAL_EXPIRED' | 'PLAN_UPGRADE_REQUIRED' | 'ENTITLEMENT_UNAVAILABLE';

export interface Authorization {
  allowed: boolean;
  plan: PlanType;
  code?: DenialCode;
  error?: string;
}

const SUBSCRIBED_STATUSES = new Set(['active', 'trialing']);

// Qué funciones existen en cada plan. Los cupos de volumen (mensajes, documentos
// al mes) se siguen contando en la interfaz; aquí solo se decide sí o no.
const PLAN_FEATURES: Record<PlanType, Record<PlanFeature, boolean>> = {
  admin: { chat: true, document_analysis: true, email_module: true },
  plan_99: { chat: true, document_analysis: true, email_module: true },
  plan_29: { chat: true, document_analysis: true, email_module: true },
  demo: { chat: true, document_analysis: true, email_module: false },
};

const FEATURE_LABELS: Record<PlanFeature, string> = {
  chat: 'El chat de mercado',
  document_analysis: 'El análisis de documentos',
  email_module: 'El módulo de correo',
};

async function resolvePlan(
  base44: any,
  user: any,
): Promise<{ plan: PlanType; trialEndsAt: string | null }> {
  const email = String(user?.email || '').toLowerCase().trim();

  if (user?.role === 'admin') {
    return { plan: 'admin', trialEndsAt: null };
  }

  // Lecturas con service role: el plan no depende de lo que el cliente pueda ver.
  const db = base44.asServiceRole.entities;

  // Cuentas de prueba: la lista vive en la entidad TestAccount, nunca en el código.
  const testAccounts = await db.TestAccount.filter({ user_email: email });
  if ((testAccounts || []).some((t: any) => t.active !== false)) {
    return { plan: 'admin', trialEndsAt: null };
  }

  // Plan de pago: alguna organización del usuario con suscripción vigente.
  const members = await db.OrganizationMember.filter({ user_email: email, active: true });
  const orgIds = (members || []).map((m: any) => m.organization_id).filter(Boolean);
  if (orgIds.length) {
    const orgs = (
      await Promise.all(
        orgIds.map((id: string) =>
          db.Organization.filter({ id }).then((rows: any[]) => rows?.[0] || null),
        ),
      )
    ).filter(Boolean);
    const subscribed = orgs.find((o: any) => SUBSCRIBED_STATUSES.has(o.subscription_status));
    if (subscribed) {
      const plan: PlanType =
        subscribed.plan_type === 'plan_99' || subscribed.account_type === 'dispatcher'
          ? 'plan_99'
          : 'plan_29';
      return { plan, trialEndsAt: null };
    }
  }

  // Sin suscripción manda el registro de prueba (uno solo por identidad).
  const trials = await db.DemoTrial.filter({ user_email: email });
  return { plan: 'demo', trialEndsAt: trials?.[0]?.trial_ends_at ?? null };
}

export async function authorizePlanFeature(
  base44: any,
  user: any,
  feature: PlanFeature,
): Promise<Authorization> {
  let plan: PlanType;
  let trialEndsAt: string | null;

  try {
    ({ plan, trialEndsAt } = await resolvePlan(base44, user));
  } catch (error) {
    console.error('[entitlements] no se pudo resolver el plan:', error);
    return {
      allowed: false,
      plan: 'demo',
      code: 'ENTITLEMENT_UNAVAILABLE',
      error: 'No pudimos verificar tu plan. Intenta de nuevo en unos segundos.',
    };
  }

  if (!PLAN_FEATURES[plan][feature]) {
    return {
      allowed: false,
      plan,
      code: 'PLAN_UPGRADE_REQUIRED',
      error:
        plan === 'demo'
          ? `${FEATURE_LABELS[feature]} no está incluido en la versión demo. Activa un plan para usarlo.`
          : `${FEATURE_LABELS[feature]} requiere un plan superior.`,
    };
  }

  if (plan === 'demo') {
    const endsAt = trialEndsAt ? Date.parse(trialEndsAt) : NaN;
    if (Number.isNaN(endsAt) || endsAt <= Date.now()) {
      return {
        allowed: false,
        plan,
        code: 'TRIAL_EXPIRED',
        error: 'Tu periodo de prueba terminó. Activa un plan para continuar.',
      };
    }
  }

  return { allowed: true, plan };
}