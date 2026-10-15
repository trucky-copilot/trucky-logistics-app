// ─────────────────────────────────────────────────────────────────────────────
// PERF TRACKER — Fase 0 del plan de latencia del Chat de Mercado.
//
// Por qué existe: en producción el chat tarda y no sabemos si el tiempo se va
// en el LLM, en las lecturas a MongoDB (entidades Base44) o en Google Maps.
// Este módulo mide cada etapa del handler SIN cambiar su lógica, para decidir
// la Fase 3 con datos y no con suposiciones.
//
// Diseño:
// - Un tracker POR REQUEST (nunca de módulo): la instancia Deno puede atender
//   varias requests concurrentes y un estado global mezclaría tiempos.
// - `time()` envuelve una función async y registra su duración incluso si
//   lanza (finally), para que los timeouts de BD también queden medidos.
// - Etapas repetidas (ej. dos llamadas a Maps) se acumulan bajo la misma
//   etiqueta con un contador.
// ─────────────────────────────────────────────────────────────────────────────

export interface PerfStage {
  /** Milisegundos acumulados de la etapa. */
  ms: number;
  /** Cuántas veces se ejecutó la etapa en esta request. */
  count: number;
  /** true si alguna ejecución lanzó excepción (útil para detectar timeouts). */
  failed?: boolean;
}

export interface PerfSummary {
  totalMs: number;
  stages: Record<string, PerfStage>;
}

export interface PerfTracker {
  /**
   * Mide la duración de `fn` bajo `label`. Devuelve el resultado de `fn` y
   * re-lanza su error sin modificarlo (transparente para el caller).
   */
  time<T>(label: string, fn: () => Promise<T>): Promise<T>;
  /** Resumen redondeado a ms enteros, listo para log o para el payload. */
  summary(): PerfSummary;
}

/** Reloj monotónico: no se ve afectado por ajustes del reloj del sistema. */
const now = (): number => performance.now();

export function createPerfTracker(): PerfTracker {
  const startedAt = now();
  const stages: Record<string, PerfStage> = {};

  const record = (label: string, elapsed: number, failed: boolean) => {
    const stage = stages[label] ?? { ms: 0, count: 0 };
    stage.ms += elapsed;
    stage.count += 1;
    if (failed) stage.failed = true;
    stages[label] = stage;
  };

  return {
    async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
      const t0 = now();
      let failed = false;
      try {
        return await fn();
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        record(label, now() - t0, failed);
      }
    },

    summary(): PerfSummary {
      const rounded: Record<string, PerfStage> = {};
      for (const [label, stage] of Object.entries(stages)) {
        rounded[label] = { ...stage, ms: Math.round(stage.ms) };
      }
      return { totalMs: Math.round(now() - startedAt), stages: rounded };
    },
  };
}

/**
 * Formato de una línea para los logs de Base44, ej.:
 * `[perf] total=4120ms | llm.extract=2900ms | db.stateMarketData=610ms | ...`
 * Ordenado de mayor a menor para ver el cuello de botella primero.
 */
export function formatPerfLine(summary: PerfSummary): string {
  const parts = Object.entries(summary.stages)
    .sort(([, a], [, b]) => b.ms - a.ms)
    .map(([label, s]) => `${label}=${s.ms}ms${s.count > 1 ? `(x${s.count})` : ''}${s.failed ? '!' : ''}`);
  return `[perf] total=${summary.totalMs}ms | ${parts.join(' | ')}`;
}

/**
 * Registra el resumen en logs y lo adjunta como `_perf` al cuerpo JSON.
 *
 * Por qué en el cuerpo y no en un header: la llamada pasa por el proxy de
 * Base44 y los headers custom no están expuestos por CORS al navegador; el
 * cuerpo sí llega siempre y el frontend lo imprime en consola.
 * Si la respuesta no es JSON (ej. OPTIONS) se devuelve intacta.
 */
export async function attachPerf(response: Response, perf: PerfTracker): Promise<Response> {
  const summary = perf.summary();
  console.log(formatPerfLine(summary));

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return response;

  try {
    const body = await response.clone().json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return response;
    return Response.json(
      { ...body, _perf: summary },
      { status: response.status, headers: response.headers },
    );
  } catch (_error) {
    // Si el cuerpo no se puede parsear, no arriesgamos la respuesta.
    return response;
  }
}
