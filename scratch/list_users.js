const users = await base44.entities.User.list();
console.log("NATIVE USERS:", JSON.stringify(users.map(u => ({ id: u.id, email: u.email, role: u.role })), null, 2));
