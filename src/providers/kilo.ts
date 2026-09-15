import { toolDefinitions } from '../tools.js';
import { RouteError, type Connector, type Route } from '../types.js';
import { freeModels } from './openrouter.js';
import { object, parseCompletion, statusError } from './chat-completions.js';
import { contextBudget, endpoint, manualConsent } from './http.js';
import { chatMessages } from './memory.js';

export class Kilo implements Connector {
  private readonly baseURL: string;
  constructor(private readonly key: string, override?: string) { this.baseURL = endpoint(override, 'https://api.kilo.ai/api/gateway'); }
  async models(signal = AbortSignal.timeout(15_000)) {
    const response = await fetch(`${this.baseURL}/models`, { signal, redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); throw statusError(response.status, response.headers.get('retry-after')); }
    const payload = object(await response.json());
    if (!Array.isArray(payload.data)) throw new RouteError('Cannot verify Kilo model prices.', 'policy');
    return freeModels({ data: payload.data.filter(value => { const model = object(value); return model.isFree === true && !model.autoRouting; }) });
  }
  route(model: string): Route {
    return { id: `kilo/${model}`, provider: 'kilo', model,
      manualApproval: 'Kilo free endpoints may retain prompts for model improvement. Use only public, non-confidential task data; NVIDIA endpoints are trial use only.',
      complete: async (messages, signal, onText, consent) => {
        manualConsent(consent);
        const selected = (await this.models(AbortSignal.any([signal, AbortSignal.timeout(15_000)]))).find(item => item.id === model);
        if (!selected) throw new RouteError('Selected Kilo model is not an explicit, currently zero-priced tool route.', 'policy');
        const body = { model, messages: chatMessages(messages, 'kilo', model), tools: toolDefinitions, tool_choice: 'auto', stream: true, max_tokens: 2048 };
        contextBudget(body, selected.context);
        const response = await fetch(`${this.baseURL}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]), redirect: 'error' });
        return parseCompletion(response, onText);
      },
    };
  }
}
