// Administradores de la app (panel /admin y tarifas). Lista cerrada: solo
// estos correos, y además deben tener rol "admin" en Base44 (App Users),
// porque los permisos de las tablas (RLS) los valida Base44 por rol.
// Cualquier otra cuenta —incluidas las de pruebas— no es administradora.
// Mantener sincronizado con base44/shared/adminAccess.ts.
export const ADMIN_EMAILS = Object.freeze([
  'luis.bermudez@ogm.com.co',
  'juan.grau@ogm.com.co',
]);

export function isAppAdmin(user) {
  const email = String(user?.email || '').toLowerCase().trim();
  return user?.role === 'admin' && ADMIN_EMAILS.includes(email);
}
