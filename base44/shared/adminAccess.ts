// Administradores de la app — misma lista que src/lib/adminAccess.js.
// Se exige rol "admin" en Base44 Y correo en la lista. El correo viene de
// base44.auth.me() (sesión verificada por Base44), no del cuerpo del request.
export const ADMIN_EMAILS: readonly string[] = Object.freeze([
  'luis.bermudez@ogm.com.co',
  'juan.grau@ogm.com.co',
]);

export function isAppAdmin(user: { role?: string; email?: string } | null | undefined): boolean {
  const email = String(user?.email || '').toLowerCase().trim();
  return user?.role === 'admin' && ADMIN_EMAILS.includes(email);
}
