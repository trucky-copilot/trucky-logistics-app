/** Server-only policy. Legacy exceptions must be granted by a trusted migration,
 * never inferred from missing billing fields or requested by a browser. */
export function subscriptionAccess(organization, now = Date.now()) {
  if (organization.billing_access_mode === 'legacy_exempt') return { allowed: true, reason: 'legacy_exempt' };
  if (organization.billing_access_mode !== 'subscription_required') return { allowed: false, reason: 'migration_required' };
  if (organization.subscription_status === 'active') return { allowed: true, reason: 'active' };
  if (organization.subscription_status === 'trialing') {
    const end = Date.parse(organization.trial_ends_at || '');
    return Number.isFinite(end) && end > now
      ? { allowed: true, reason: 'trialing' }
      : { allowed: false, reason: 'trial_expired' };
  }
  return { allowed: false, reason: 'subscription_required' };
}
