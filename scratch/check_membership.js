const orgs = await base44.entities.Organization.list();
console.log("ORGANIZATIONS:", JSON.stringify(orgs, null, 2));

const members = await base44.entities.OrganizationMember.list();
console.log("MEMBERS:", JSON.stringify(members, null, 2));
