export function hasSubscriptionAccess(org: { subscription_status?: string; trial_ends_at?: string }, now = Date.now()): boolean {
  if (org.subscription_status === 'active') return true;
  return org.subscription_status === 'trialing' && Number.isFinite(Date.parse(org.trial_ends_at || '')) && Date.parse(org.trial_ends_at || '') > now;
}

// Controlled acceptance only. This is NOT global production enforcement.
// Use verified test Base44 account emails selected by the operator, never a flag
// supplied in the body. Existing accounts outside this list are unchanged.
async function evaluateBillingGuard(req: Request, base44: any): Promise<Response | null> {
  if (Deno.env.get('BILLING_ACCESS_TEST_ENABLED') !== 'true') return null;
  const denied = (code: string, status: number) => new Response(JSON.stringify({ code }), { status, headers: { 'Content-Type': 'application/json' } });
  const user = await base44.auth.me();
  if (!user?.email) return denied('UNAUTHORIZED', 401);
  const accounts = new Set((Deno.env.get('BILLING_ACCESS_TEST_USER_EMAILS') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
  if (!accounts.has(user.email.toLowerCase())) return null;
  const allowedOrgs = new Set((Deno.env.get('STRIPE_TEST_ORGANIZATION_IDS') || '').split(',').map(x => x.trim()).filter(Boolean));
  const data = await req.clone().json().catch(() => ({}));
  const members = await base44.asServiceRole.entities.OrganizationMember.filter({ user_email: user.email, active: true });
  const ids = [...new Set((members || []).map((m: any) => m.organization_id))];
  // Existing operations still derive their tenant from the sole membership.
  // Until those operations accept an authoritative tenant context, reject
  // multi-tenant actors rather than authorize one org and operate on another.
  if (ids.length !== 1) return denied('TENANT_CONTEXT_NOT_SUPPORTED', 403);
  const selected = data.organization_id || ids[0];
  if (data.organization_id && data.organization_id !== ids[0]) return denied('TENANT_MISMATCH', 403);
  if (!selected || !ids.includes(selected)) return denied('ORGANIZATION_SELECTION_REQUIRED', 403);
  if (!allowedOrgs.has(selected)) return denied('TEST_ORGANIZATION_NOT_ALLOWED', 403);
  const org = (await base44.asServiceRole.entities.Organization.filter({ id: selected }))?.[0];
  if (!org || org.active === false) return denied('ORGANIZATION_UNAVAILABLE', 403);
  if (!hasSubscriptionAccess(org)) return denied('SUBSCRIPTION_REQUIRED', 402);
  return null;
}

// Do not allow a parent operation's legacy catch/fallback to continue after an
// authorization lookup fails. A failed guard always returns an HTTP response.
export async function billingGuard(req: Request, base44: any): Promise<Response | null> {
  try { return await evaluateBillingGuard(req, base44); }
  catch { return new Response(JSON.stringify({ code: 'BILLING_AUTHORIZATION_UNAVAILABLE' }), {
    status: 503, headers: { 'Content-Type': 'application/json' },
  }); }
}
