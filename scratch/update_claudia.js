// Script to inspect the Stripe subscription and update Organization
const orgId = "6ae14d91f703b215799656ce";
const org = await base44.entities.Organization.get(orgId);
console.log("Current Org:", JSON.stringify(org, null, 2));

// Update org to plan_99 directly
await base44.entities.Organization.update(orgId, {
  plan_type: "plan_99",
  account_type: "dispatcher"
});

const updated = await base44.entities.Organization.get(orgId);
console.log("Updated Org:", JSON.stringify(updated, null, 2));
