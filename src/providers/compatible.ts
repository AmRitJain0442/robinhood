import { toolDefinitions } from '../tools.js';
import { RouteError, type Connector, type ModelInfo, type Route } from '../types.js';
import { object, parseCompletion, statusError, boundedJSON, jsonCompletion } from './chat-completions.js';
import { contextBudget, endpoint, manualConsent } from './http.js';
import { chatMessages } from './memory.js';

export interface CompatibleSpec {
  id: string;
  name: string;
  baseURL: string;
  models: ModelInfo[];
  discoverModels?: (data: unknown[]) => ModelInfo[];
  modelsPath?: string | null;
  completionPath?: string;
  maxTokenField?: 'max_tokens' | 'max_completion_tokens';
  headers?: Record<string, string>;
  keyHeader?: string;
  extraBody?: Record<string, unknown>;
  notice?: string;
  omitToolChoice?: boolean;
  nonStreaming?: boolean;
}

// Shared only where the provider documents Chat Completions compatibility.
// Provider-specific endpoints, models and request options stay in reviewed specs.
export class Compatible implements Connector {
  private readonly baseURL: string;
  constructor(readonly spec: CompatibleSpec, private readonly key: string, override?: string) { this.baseURL = endpoint(override, spec.baseURL); }
  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', ...this.spec.headers, ...(this.spec.keyHeader ? { [this.spec.keyHeader]: this.key } : { Authorization: `Bearer ${this.key}` }) };
  }
  async models(signal = AbortSignal.timeout(15_000)): Promise<ModelInfo[]> {
    if (!this.key) throw new RouteError(`Connect a ${this.spec.name} API key first.`, 'auth');
    if (this.spec.modelsPath === null) return this.spec.models.map(model => ({ ...model }));
    const response = await fetch(`${this.baseURL}${this.spec.modelsPath ?? '/models'}`, { headers: this.headers(), signal, redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); throw statusError(response.status, response.headers.get('retry-after')); }
    const data = object(await response.json()).data;
    if (!Array.isArray(data)) throw new RouteError(`${this.spec.name} returned a malformed model catalog.`, 'protocol');
    if (this.spec.discoverModels) return this.spec.discoverModels(data);
    const available = new Set(data.filter(item => object(item).active !== false).map(item => object(item).id));
    return this.spec.models.filter(model => available.has(model.id));
  }
  route(model: string): Route {
    return { id: `${this.spec.id}/${model}`, provider: this.spec.id, model,
      manualApproval: `${this.spec.name} account tier, trial credits, and remaining free allowance are not machine-verified. This request may consume credits or incur charges.${this.spec.notice ? ` ${this.spec.notice}` : ''}`,
      complete: async (messages, signal, onText, consent) => {
        manualConsent(consent);
        const selected = (await this.models(AbortSignal.any([signal, AbortSignal.timeout(15_000)]))).find(item => item.id === model);
        if (!selected) throw new RouteError(`Choose a supported model from /models ${this.spec.id}.`, 'policy');
        const body = { ...this.spec.extraBody, model, messages: chatMessages(messages, this.spec.id, model), tools: toolDefinitions, ...(this.spec.omitToolChoice ? {} : { tool_choice: 'auto' }), stream: !this.spec.nonStreaming, [this.spec.maxTokenField ?? 'max_tokens']: 2048 };
        contextBudget(body, selected.context);
        const response = await fetch(`${this.baseURL}${this.spec.completionPath ?? '/chat/completions'}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]), redirect: 'error' });
        return this.spec.nonStreaming ? jsonCompletion(await boundedJSON(response), onText) : parseCompletion(response, onText);
      },
    };
  }
}
