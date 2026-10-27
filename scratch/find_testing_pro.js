const orgs = await base44.entities.Organization.list();
const testingPro = orgs.find(o => o.name && o.name.toLowerCase().includes("testing-pro")) || orgs.find(o => o.name && o.name.toLowerCase().includes("testing"));
console.log("MATCHING ORG:", JSON.stringify(testingPro, null, 2));

if (testingPro) {
  const members = await base44.entities.OrganizationMember.filter({ organization_id: testingPro.id });
  console.log("TESTING-PRO MEMBERS:", JSON.stringify(members, null, 2));
} else {
  console.log("ALL ORGS:", JSON.stringify(orgs.map(o => ({ id: o.id, name: o.name })), null, 2));
}
