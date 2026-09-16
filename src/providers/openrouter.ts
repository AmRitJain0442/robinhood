import { toolDefinitions } from '../tools.js';
import { RouteError, type Route } from '../types.js';
import { object, parseCompletion } from './chat-completions.js';
import { chatMessages } from './memory.js';
export { parseCompletion } from './chat-completions.js';

export interface FreeModel { id: string; context: number }

export function freeModels(payload: unknown): FreeModel[] {
  const data = object(payload).data;
  if (!Array.isArray(data)) throw new RouteError('Model catalog is unavailable or malformed.', 'policy');
  return data.flatMap(value => {
    const item = object(value);
    const pricing = object(item.pricing);
    const zero = (price: unknown) => (typeof price === 'string' && price.trim() !== '' || typeof price === 'number') && Number(price) === 0;
    if (typeof item.id !== 'string' || !item.id.endsWith(':free')) return [];
    if (!zero(pricing.prompt) || !zero(pricing.completion) || !Object.values(pricing).every(zero)) return [];
    if (!Array.isArray(item.supported_parameters) || !item.supported_parameters.includes('tools')) return [];
    if (typeof item.context_length !== 'number' || !Number.isSafeInteger(item.context_length) || item.context_length < 8192) return [];
    return [{ id: item.id, context: item.context_length }];
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export class OpenRouter {
  constructor(private readonly key: string, private readonly baseURL = 'https://openrouter.ai/api/v1') {
    const url = new URL(baseURL);
    if (baseURL !== 'https://openrouter.ai/api/v1' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Only OpenRouter or a loopback test server is supported.');
  }

  async models(signal = AbortSignal.timeout(15_000)): Promise<FreeModel[]> {
    const response = await fetch(`${this.baseURL}/models`, { signal, redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); throw new RouteError('Cannot verify current model pricing; no inference request was sent.', 'policy'); }
    return freeModels(await response.json());
  }

  route(model: string): Route {
    return {
      id: `openrouter/${model}`, provider: 'openrouter', model,
      complete: async (messages, signal, onText, _consent, options) => {
        signal.throwIfAborted();
        // Refresh immediately before every request; no cached price can authorize inference.
        const selected = (await this.models(AbortSignal.any([signal, AbortSignal.timeout(15_000)]))).find(item => item.id === model);
        if (!selected) throw new RouteError('Selected model is not currently a verified free tool-capable route.', 'policy');
        const body = { model, messages: chatMessages(messages, 'openrouter', model), tools: options?.tools ?? toolDefinitions, tool_choice: 'auto', max_tokens: 2048, stream: true, provider: { allow_fallbacks: false, require_parameters: true } };
        // Byte count is a conservative context estimate, not reported provider token usage.
        if (Buffer.byteLength(JSON.stringify(body)) + 4096 > Math.min(selected.context, 64000)) throw new RouteError('Session exceeds this preview\'s conservative context budget. Automatic compaction is not implemented.', 'policy');
        if (!this.key) throw new RouteError('Connect an OpenRouter API key first.', 'auth');
        const response = await fetch(`${this.baseURL}/chat/completions`, {
          method: 'POST', headers: { Authorization: `Bearer ${this.key}`, 'content-type': 'application/json', 'X-Title': 'Robinhood' },
          body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]), redirect: 'error',
        });
        return parseCompletion(response, onText, { provider: 'openrouter', model });
      },
    };
  }
}
