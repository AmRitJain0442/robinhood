import { createParser } from 'eventsource-parser';
import { toolDefinitions } from '../tools.js';
import { RouteError, type Completion, type Message, type Route, type ToolCall, type Usage } from '../types.js';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const nonnegative = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

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

function statusError(status: number, retry: string | null): RouteError {
  const seconds = retry === null ? NaN : Number(retry);
  const parsedDate = retry === null ? NaN : Date.parse(retry);
  const ms = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Number.isFinite(parsedDate) ? Math.max(0, parsedDate - Date.now()) : undefined;
  if (status === 429) return new RouteError('Provider request limit reached.', 'quota', ms);
  if (status === 401 || status === 403) return new RouteError('Provider rejected the credentials or access. Reconnect to continue.', 'auth');
  if (status === 402) return new RouteError('Provider requires payment. This route is blocked.', 'policy');
  if (status >= 500) return new RouteError('Provider is temporarily unavailable.', 'capacity', ms);
  return new RouteError(`Provider returned HTTP ${status}. No automatic retry was made.`, 'protocol');
}

export async function parseCompletion(response: Response, onText: (text: string) => void): Promise<Completion> {
  if (!response.ok) { await response.body?.cancel(); throw statusError(response.status, response.headers.get('retry-after')); }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new RouteError('Expected an event stream from the provider.', 'protocol');
  let content = '';
  let done = false;
  let finished = false;
  let usage: Usage | undefined;
  let bytes = 0;
  const calls = new Map<number, ToolCall>();
  const parser = createParser({
    maxBufferSize: 128 * 1024,
    onError(error) { throw new RouteError(`Invalid provider stream: ${error.type}`, 'protocol'); },
    onEvent(event) {
      if (done) return;
      if (event.data === '[DONE]') { done = true; return; }
      const data = object(JSON.parse(event.data));
      if (data.error) {
        const code = Number(object(data.error).code);
        if (Number.isFinite(code) && code >= 400) throw statusError(code, null);
        throw new RouteError('Provider reported an error during streaming.', 'protocol');
      }
      if (data.usage) {
        const reported = object(data.usage);
        usage = { inputTokens: nonnegative(reported.prompt_tokens), outputTokens: nonnegative(reported.completion_tokens) };
      }
      const choice = object(Array.isArray(data.choices) ? data.choices[0] : undefined);
      if (choice.finish_reason === 'error') throw new RouteError('Provider stream ended with an error.', 'protocol');
      if (choice.finish_reason === 'length') throw new RouteError('Model output limit reached; incomplete tool calls were not executed.', 'protocol');
      if (choice.finish_reason === 'stop' || choice.finish_reason === 'tool_calls') finished = true;
      const delta = object(choice.delta);
      if (typeof delta.content === 'string') { content += delta.content; onText(delta.content); }
      if (Array.isArray(delta.tool_calls)) for (const value of delta.tool_calls) {
        const part = object(value);
        if (typeof part.index !== 'number' || !Number.isInteger(part.index) || part.index < 0 || part.index > 7) throw new RouteError('Invalid or excessive tool calls.', 'protocol');
        const call = calls.get(part.index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
        const fn = object(part.function);
        if (typeof part.id === 'string') call.id += part.id;
        if (typeof fn.name === 'string') call.function.name += fn.name;
        if (typeof fn.arguments === 'string') call.function.arguments += fn.arguments;
        calls.set(part.index, call);
      }
    },
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 1024 * 1024) throw new RouteError('Provider response exceeded the 1 MiB limit.', 'protocol');
      parser.feed(decoder.decode(chunk.value, { stream: true }));
    }
    if (!done || !finished) throw new RouteError('Provider stream disconnected before completion.', 'protocol');
    const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
    const ids = new Set<string>();
    for (const call of toolCalls) {
      if (!/^[\w.:-]{1,200}$/.test(call.id) || !/^[\w-]{1,64}$/.test(call.function.name) || ids.has(call.id)) throw new RouteError('Invalid or duplicate tool call identifier.', 'protocol');
      ids.add(call.id);
      try { JSON.parse(call.function.arguments); } catch { throw new RouteError('Incomplete tool arguments were not executed.', 'protocol'); }
    }
    return { message: { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, usage };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
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
      complete: async (messages, signal, onText) => {
        signal.throwIfAborted();
        // Refresh immediately before every request; no cached price can authorize inference.
        const selected = (await this.models(AbortSignal.any([signal, AbortSignal.timeout(15_000)]))).find(item => item.id === model);
        if (!selected) throw new RouteError('Selected model is not currently a verified free tool-capable route.', 'policy');
        const body = { model, messages, tools: toolDefinitions, tool_choice: 'auto', max_tokens: 2048, stream: true, provider: { allow_fallbacks: false, require_parameters: true } };
        // Byte count is a conservative context estimate, not reported provider token usage.
        if (Buffer.byteLength(JSON.stringify(body)) + 4096 > Math.min(selected.context, 64000)) throw new RouteError('Session exceeds this preview\'s conservative context budget. Automatic compaction is not implemented.', 'policy');
        if (!this.key) throw new RouteError('Connect an OpenRouter API key first.', 'auth');
        const response = await fetch(`${this.baseURL}/chat/completions`, {
          method: 'POST', headers: { Authorization: `Bearer ${this.key}`, 'content-type': 'application/json', 'X-Title': 'Robinhood' },
          body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]), redirect: 'error',
        });
        return parseCompletion(response, onText);
      },
    };
  }
}
