import { toolDefinitions } from '../tools.js';
import { RouteError, type Connector, type Route } from '../types.js';
import { boundedJSON, jsonCompletion, object } from './chat-completions.js';
import { contextBudget, endpoint, manualConsent } from './http.js';
import { chatMessages } from './memory.js';

// Driver envelope reviewed against the published @heyputer/puter.js 2.6.3 source.
// Direct transport keeps cancellation and no-retry behavior under our control.
export class Puter implements Connector {
  private readonly baseURL: string;
  constructor(private readonly key: string, override?: string) { this.baseURL = endpoint(override, 'https://api.puter.com'); }
  async models() {
    if (!this.key) throw new RouteError('Connect a Puter user auth token first.', 'auth');
    return [{ id: 'gpt-4o-mini', context: 64000 }];
  }
  route(model: string): Route {
    return { id: `puter/${model}`, provider: 'puter', model,
      manualApproval: 'This request uses your Puter user allowance. Remaining free balance is unverified and funded accounts may be charged.',
      complete: async (messages, signal, onText, consent) => {
        manualConsent(consent);
        if (!(await this.models()).some(item => item.id === model)) throw new RouteError('Choose a reviewed Puter model from /models puter.', 'policy');
        const args = { messages: chatMessages(messages, 'puter', model), model, provider: 'openai', tools: toolDefinitions, stream: false, normalize: true, max_tokens: 2048 };
        contextBudget(args, 64000);
        const data = object(await boundedJSON(await fetch(`${this.baseURL}/drivers/call`, {
          method: 'POST', headers: { 'content-type': 'text/plain;actually=json' },
          body: JSON.stringify({ interface: 'puter-chat-completion', driver: 'ai-chat', method: 'complete', test_mode: false, auth_token: this.key, args }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]), redirect: 'error',
        })));
        if (data.success === false || data.error) {
          const code = object(data.error).code;
          if (code === 'insufficient_funds' || object(data.metadata).usage_limited === true) throw new RouteError('Puter allowance exhausted.', 'quota');
          if (code === 'token_auth_failed') throw new RouteError('Puter rejected the auth token.', 'auth');
          throw new RouteError('Puter rejected this request. No retry was made.', 'protocol');
        }
        const result = object(data.result ?? data);
        return jsonCompletion({ choices: [{ message: result.message, finish_reason: result.finish_reason }], usage: result.usage }, onText);
      },
    };
  }
}
