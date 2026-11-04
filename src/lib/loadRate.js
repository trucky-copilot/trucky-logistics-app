/**
 * Tarifa efectiva de una carga (QA): la negociada si existe; si no, la ofrecida.
 * Antes, una carga sin "tarifa negociada" mostraba $0 de total, $0.00/mi y
 * "Tarifa acordada: $0" en el borrador, aunque la ofrecida fuera $800.
 */
export function effectiveRate(load) {
  const negotiated = Number(load?.tarifa_negociada);
  if (Number.isFinite(negotiated) && negotiated > 0) return negotiated;
  const offered = Number(load?.tarifa_ofrecida);
  return Number.isFinite(offered) && offered > 0 ? offered : 0;
}

export function effectiveRpm(load) {
  const miles = Number(load?.millas) || 0;
  return miles > 0 ? effectiveRate(load) / miles : 0;
}

/** Misma fórmula que se usa al guardar en Cargas (diésel a 6.5 MPG + 25% de costo). */
export function estimateProfit(load) {
  const rate = effectiveRate(load);
  const miles = Number(load?.millas) || 0;
  const diesel = Number(load?.diesel_precio_dia) || 0;
  const dieselCost = miles > 0 && diesel > 0 ? (miles / 6.5) * diesel : 0;
  return rate - dieselCost - rate * 0.25;
}

/** Ganancia a mostrar: si la carga se guardó sin negociada, se recalcula con la ofrecida. */
export function effectiveProfit(load) {
  const negotiated = Number(load?.tarifa_negociada);
  if (Number.isFinite(negotiated) && negotiated > 0 && load?.ganancia_estimada != null) {
    return Number(load.ganancia_estimada) || 0;
  }
  return estimateProfit(load);
}
