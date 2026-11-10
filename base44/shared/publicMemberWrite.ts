// Conditional single-membership identity write for reviewed existing enrollment.
// Each identity field is pinned to its exact state from a fresh read:
//   absent → {$exists:false}, explicit null → null, value → that exact value.
// Never replaced by "read, then unconditional write" (that reintroduces the race).
export type Rec = Record<string, unknown>;
export function fieldCondition(record: Rec, key: string): unknown {
  if (!Object.hasOwn(record, key) || record[key] === undefined) return { $exists: false };
  if (record[key] === null) return null;
  return record[key];
}
export function pinnedMemberQuery(member: Rec, orgId: string): Rec {
  return {
    id: member.id, organization_id: orgId, role: 'owner', active: true,
    google_sub: fieldCondition(member, 'google_sub'),
    base44_user_id: fieldCondition(member, 'base44_user_id'),
  };
}
export interface MemberWriteDeps {
  updateMember: (query: Rec, fields: Rec) => Promise<{ updated?: unknown } | unknown>;
  member: (id: string) => Promise<Rec | null | undefined>;
}
/**
 * Service-role acceptance reports matched rows: an identical repeat may return 1.
 * Neither 1 nor 0 proves the identity on its own. The result is
 * always confirmed by a fresh read of the exact record:
 *  - WRITTEN: updated===1 and the read shows exactly the target (includes an identical repeat).
 *  - ALREADY_APPLIED: updated===0 and the read shows exactly the target (defensive idempotent handling).
 *  - REJECTED: anything else (different identity, concurrent change, unknown answer).
 */
export async function conditionalIdentityWrite(
  d: MemberWriteDeps, member: Rec, orgId: string, target: { google_sub: string; base44_user_id: string },
): Promise<'WRITTEN' | 'ALREADY_APPLIED' | 'REJECTED'> {
  const write: any = await d.updateMember(pinnedMemberQuery(member, orgId), target);
  if (write?.updated !== 1 && write?.updated !== 0) return 'REJECTED';
  const now = await d.member(String(member.id));
  const exact = !!now && now.id === member.id && now.organization_id === orgId && now.role === 'owner' &&
    now.active === true && now.google_sub === target.google_sub && now.base44_user_id === target.base44_user_id;
  if (!exact) return 'REJECTED';
  return write.updated === 1 ? 'WRITTEN' : 'ALREADY_APPLIED';
}
