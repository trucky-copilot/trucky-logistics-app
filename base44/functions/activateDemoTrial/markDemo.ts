// Al activar el demo desde la página web, las empresas del usuario que no
// tienen plan pagado quedan con subscription_status = 'demo' (antes quedaban
// vacías o en 'none' y no se distinguían de las cuentas sin demo).
const PAID = new Set(['active', 'trialing', 'past_due']);

export async function markOrganizationsDemo(db: any, email: string): Promise<number> {
  const members = await db.OrganizationMember.filter({ user_email: String(email || '').toLowerCase(), active: true });
  let n = 0;
  for (const m of members || []) {
    const org = (await db.Organization.filter({ id: m.organization_id }))?.[0];
    if (org && !PAID.has(org.subscription_status) && org.subscription_status !== 'demo') {
      await db.Organization.update(org.id, { subscription_status: 'demo' });
      n++;
    }
  }
  return n;
}
