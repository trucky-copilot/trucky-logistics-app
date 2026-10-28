const target = "claudiaaceroacosta@gmail.com";
const typoTarget = "caludiaaceroacosta@gmail.com";

console.log("=== CHECKING USERS ===");
const users = await base44.entities.User.list();
const matchedUsers = users.filter(u => 
  (u.email && (u.email.toLowerCase().includes("claudia") || u.email.toLowerCase().includes("caludia")))
);
console.log("Matched Users:", JSON.stringify(matchedUsers, null, 2));

console.log("=== CHECKING USER PROFILES ===");
const profiles = await base44.entities.UserProfile.list();
const matchedProfiles = profiles.filter(p =>
  (p.usuario && (p.usuario.toLowerCase().includes("claudia") || p.usuario.toLowerCase().includes("caludia")))
);
console.log("Matched UserProfiles:", JSON.stringify(matchedProfiles, null, 2));

console.log("=== CHECKING ORGANIZATION MEMBERS ===");
const members = await base44.entities.OrganizationMember.list();
const matchedMembers = members.filter(m =>
  (m.user_email && (m.user_email.toLowerCase().includes("claudia") || m.user_email.toLowerCase().includes("caludia")))
);
console.log("Matched Members:", JSON.stringify(matchedMembers, null, 2));

console.log("=== CHECKING ALL ORGANIZATIONS ===");
const orgs = await base44.entities.Organization.list();
const relevantOrgIds = new Set(matchedMembers.map(m => m.organization_id));
const relevantOrgs = orgs.filter(o => 
  relevantOrgIds.has(o.id) || 
  (o.created_by_user && (o.created_by_user.toLowerCase().includes("claudia") || o.created_by_user.toLowerCase().includes("caludia")))
);
console.log("Relevant Organizations:", JSON.stringify(relevantOrgs, null, 2));

console.log("=== ALL SUBSCRIBED ORGS IN SYSTEM ===");
const subscribedOrgs = orgs.filter(o => o.subscription_status && o.subscription_status !== "none");
console.log("Subscribed Orgs:", JSON.stringify(subscribedOrgs, null, 2));
