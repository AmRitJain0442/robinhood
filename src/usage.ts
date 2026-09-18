import type { Store } from './storage.js';

export interface UsageBucket { input: number; output: number; requests: number; reported: number; failures: number }
const bucket = (): UsageBucket => ({ input: 0, output: 0, requests: 0, reported: 0, failures: 0 });
export function usageSummary(store: Store, workspace?: string) {
  const total = bucket();
  const providers: Record<string, UsageBucket> = {};
  const models: Record<string, UsageBucket> = {};
  const days: Record<string, UsageBucket> = {};
  const sessions = store.list().filter(session => !workspace || session.workspace === workspace);
  for (const session of sessions) {
    let route = 'unknown';
    for (const event of store.events(session.id)) {
      const value = event.body as Record<string, unknown> | null;
      if (!value || typeof value !== 'object') continue;
      if (['route', 'request-attempt'].includes(event.kind) && typeof value.route === 'string') route = value.route;
      if (!['usage', 'request-attempt', 'request-error'].includes(event.kind)) continue;
      const provider = typeof value.provider === 'string' ? value.provider : route.split('/')[0] || 'unknown';
      const model = typeof value.model === 'string' ? `${provider}/${value.model}` : route;
      const targets = [total, providers[provider] ??= bucket(), models[model] ??= bucket(), days[event.created_at.slice(0, 10)] ??= bucket()];
      for (const target of targets) {
        if (event.kind === 'request-attempt') target.requests++;
        if (event.kind === 'request-error') target.failures++;
        if (event.kind === 'usage') {
          const valid = (number: unknown): number => typeof number === 'number' && Number.isSafeInteger(number) && number >= 0 ? number : 0;
          target.input += valid(value.inputTokens); target.output += valid(value.outputTokens);
          if (typeof value.inputTokens === 'number' || typeof value.outputTokens === 'number') target.reported++;
        }
      }
    }
  }
  return { total, providers, models, days, sessions: sessions.length, scope: workspace ? 'workspace' : 'all saved sessions', note: 'Observed usage only. Some providers omit tokens; failed requests can consume unreported tokens. Deleting sessions removes their usage history. Account balances and costs are unknown.' };
}
