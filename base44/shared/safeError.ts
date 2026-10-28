// Error de handler sin filtrar información interna.
// El detalle completo (mensaje, stack, rutas del entorno) se queda en los logs
// del servidor; al cliente solo le llega un mensaje genérico junto a un id de
// correlación para poder localizar ese fallo concreto en los logs.
export function logAndSanitizeError(scope: string, error: unknown) {
  const reference = String(
    (globalThis.crypto as any)?.randomUUID?.() || Date.now()
  ).slice(0, 8);

  console.error(`[${scope}] fallo interno (ref ${reference}):`, error);

  return {
    error: 'Error interno del servidor',
    code: 'INTERNAL_ERROR',
    reference,
  };
}