import { RouteError, type Connector, type Route } from './types.js';

// These connectors filter their catalogs to zero-priced, tool-capable models
// and recheck eligibility at inference time. Account-tier guesses are excluded.
export const automaticProviders = new Set(['openrouter', 'kilo', 'opencode', 'kilo-cli']);

export class RoutePool {
  enabled = true;
  private readonly cooldowns = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  async discover(connections: ReadonlyMap<string, Connector>, selected: Route | undefined, preferred: string | null, signal: AbortSignal, status: (text: string) => void): Promise<Route[]> {
    if (!this.enabled) return selected ? [selected] : [];
    const results = await Promise.allSettled([...connections].filter(([id]) => automaticProviders.has(id)).map(async ([id, connector]) => {
      const models = await connector.models(AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
      return models.sort((a, b) => b.context - a.context || a.id.localeCompare(b.id)).map(model => connector.route(model.id));
    }));
    signal.throwIfAborted();
    const candidates = selected ? [selected] : [];
    for (const result of results) {
      if (result.status === 'fulfilled') candidates.push(...result.value);
      else status(`Free-model discovery skipped an unavailable catalog: ${String(result.reason)}`);
    }
    const unique = [...new Map(candidates.map(route => [route.id, route])).values()];
    const available = unique.filter(route => (this.cooldowns.get(route.id) ?? 0) <= this.now());
    const preferredIndex = available.findIndex(route => route.id === preferred);
    if (preferredIndex > 0) available.unshift(...available.splice(preferredIndex, 1));
    if (!available.length && unique.length) status('All discovered routes are cooling down. Try /continue later; provider reset times may differ.');
    return available.map(route => ({ ...route, complete: async (...args) => {
      // Workflows may retain this pool across multiple steps.
      if ((this.cooldowns.get(route.id) ?? 0) > this.now()) throw new RouteError(`${route.id} is cooling down.`, 'capacity');
      try { return await route.complete(...args); }
      catch (error) {
        if (!args[1].aborted && error instanceof RouteError && ['quota', 'capacity', 'auth'].includes(error.kind)) {
          const fallback = error.kind === 'capacity' ? 60_000 : error.kind === 'auth' ? 300_000 : 900_000;
          this.cooldowns.set(route.id, this.now() + Math.max(1000, error.retryAfterMs ?? fallback));
        }
        throw error;
      }
    } }));
  }
}
