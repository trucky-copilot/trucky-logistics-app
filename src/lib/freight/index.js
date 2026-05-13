/**
 * lib/freight/index.js
 * ─────────────────────
 * Punto de entrada único para toda la lógica de freight dispatching.
 * Importar SIEMPRE desde aquí, no desde los módulos internos.
 *
 * USO:
 *   import { getRpmBenchmarks, analyzeLoadVerdict, buildAgentSystemPrompt } from '@/lib/freight';
 */

// Re-export todo el adaptador (única interfaz pública)
export * from './freightAdapter.js';

// Re-export metadata de versión
export { FREIGHT_KB_VERSION, FREIGHT_KB_UPDATED, KB_VALID } from './freightKnowledgeBase.js';

// NO re-exportar FREIGHT_KB directamente — usar el adaptador.