const members = await base44.entities.OrganizationMember.list();
const withBase44Id = members.filter(m => m.base44_user_id);
console.log("Total OrganizationMembers:", members.length);
console.log("Miembros con base44_user_id asignado:", withBase44Id.length);
if (withBase44Id.length > 0) {
  console.log("Detalle:", JSON.stringify(withBase44Id.map(m => ({ id: m.id, org: m.organization_id, email: m.user_email, base44_user_id: m.base44_user_id })), null, 2));
}

const testingProMember = members.find(m => m.organization_id === "6aac0718ff3a5154cb00ddb1");
console.log("Testing-Pro member actual:", JSON.stringify({
  id: testingProMember?.id,
  email: testingProMember?.user_email,
  google_sub: testingProMember?.google_sub,
  base44_user_id: testingProMember?.base44_user_id || null,
  active: testingProMember?.active
}, null, 2));
