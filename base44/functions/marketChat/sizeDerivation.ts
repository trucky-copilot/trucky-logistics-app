// ─────────────────────────────────────────────────────────────────────────────
// DERIVACIÓN DE TAMAÑOS DE TEXAS — dominio puro, reglas-v3-multiestado Fase 3.
//
// La tabla de Texas solo trae el 40' nativo (kickoff §11 riesgo 8: "Texas solo
// tiene 40'"). Juan confirmó (Decisión 12-C) que en Houston sí se mueven 20' y
// 45' — la captura de datos solo trajo 40' — y que los tamaños se derivan con
// los factores INVERTIDOS respecto de Florida (la base de FL es el 20'; la de
// TX es el 40'):
//
//   20'       = 40' ÷ 1.10       (factor 0.9091)
//   45'       = 40' × 1.018      (= 1.12 ÷ 1.10, verificado por Juan)
//   20' Heavy = 40' × 1.0636     (= 1.17 ÷ 1.10 — misma lógica; kickoff §12
//                                  deja permiso explícito para aplicarla)
//
// Estas cifras NO son tarifa de tabla: son un supuesto de industria aplicado
// sobre el único dato real que hay (el 40'). El 45' y el 20' Heavy son un
// supuesto CONSTRUIDO SOBRE OTRO supuesto — los propios multiplicadores están
// marcados "estándar de industria a refinar con datos propios" en la hoja de
// Florida — por eso llevan `dobleSupuesto: true` y el redactor debe advertirlo
// con más énfasis que un "derivado" normal (kickoff §12, riesgo nuevo).
// ─────────────────────────────────────────────────────────────────────────────

import type { Tamano } from './rateTable.ts';

export interface TxSizeFactor {
  factor: number;
  derivado: boolean;
  dobleSupuesto: boolean;
}

export const TX_SIZE_FACTORS: Record<Tamano, TxSizeFactor> = {
  '20': { factor: 1 / 1.10, derivado: true, dobleSupuesto: false },
  '40': { factor: 1, derivado: false, dobleSupuesto: false },
  '45': { factor: 1.12 / 1.10, derivado: true, dobleSupuesto: true },
  '20_heavy': { factor: 1.17 / 1.10, derivado: true, dobleSupuesto: true },
};

export interface DerivedTxPrice {
  valor: number;
  derivado: boolean;
  dobleSupuesto: boolean;
}

/**
 * Deriva el precio de un tamaño de Texas a partir del precio nativo del 40'.
 * `basePrecio40` puede ser el objetivo o el piso — la misma proporción aplica
 * a los dos, porque el factor es sobre el tamaño del contenedor, no sobre el
 * tipo de cifra.
 */
export function deriveTxPrice(basePrecio40: number, tamano: Tamano): DerivedTxPrice {
  const f = TX_SIZE_FACTORS[tamano];
  return {
    valor: Math.round(basePrecio40 * f.factor),
    derivado: f.derivado,
    dobleSupuesto: f.dobleSupuesto,
  };
}
