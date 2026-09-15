import { randomUUID } from 'node:crypto';
import { toolDefinitions } from '../tools.js';
import { RouteError, type Completion, type Connector, type Message, type ModelInfo, type Route, type ToolCall, type Usage } from '../types.js';
import { object, statusError } from './chat-completions.js';
import { contextBudget, endpoint, events, manualConsent } from './http.js';
import { portableMessages } from './memory.js';

// Reviewed model families; API availability is checked separately. This is not
// an assertion that the user's project belongs to Google's free billing tier.
const supported = new Set(['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']);

export function geminiHistory(messages: Message[], model: string): { systemInstruction: { parts: { text: string }[] }; contents: { role: string; parts: Record<string, unknown>[] }[] } {
  const contents: { role: string; parts: Record<string, unknown>[] }[] = [];
  const system: string[] = [];
  const names = new Map<string, { name: string; id?: unknown }>();
  for (const message of portableMessages(messages, 'gemini', model)) {
    if (message.role === 'system') { system.push(message.content ?? ''); continue; }
    let parts: Record<string, unknown>[];
    if (message.role === 'assistant' && message.providerState?.provider === 'gemini' && message.providerState.model === model) {
      parts = message.providerState.parts;
      const functions = parts.filter(part => part.functionCall).map(part => object(part.functionCall));
      for (const [index, call] of (message.tool_calls ?? []).entries()) names.set(call.id, { name: call.function.name, id: functions[index]?.id });
    } else if (message.role === 'tool') {
      const fn = names.get(message.tool_call_id ?? '');
      if (!fn) throw new RouteError('Cannot pair the Gemini tool receipt with its original call.', 'protocol');
      parts = [{ functionResponse: { name: fn.name, ...(fn.id ? { id: fn.id } : {}), response: { output: message.content ?? '' } } }];
    } else parts = [{ text: message.content ?? '' }];
    const role = message.role === 'assistant' ? 'model' : 'user';
    if (contents.at(-1)?.role === role) contents.at(-1)!.parts.push(...parts);
    else contents.push({ role, parts: [...parts] });
  }
  return { systemInstruction: { parts: [{ text: system.join('\n') }] }, contents };
}

export async function parseGemini(response: Response, model: string, onText: (text: string) => void): Promise<Completion> {
  const parts: Record<string, unknown>[] = [];
  const calls: ToolCall[] = [];
  let text = '';
  let finished = false;
  let usage: Usage | undefined;
  await events(response, value => {
    const data = object(value);
    if (data.error) throw statusError(Number(object(data.error).code) || 500, null);
    if (object(data.promptFeedback).blockReason) throw new RouteError('Gemini blocked this request.', 'protocol');
    const candidate = object(Array.isArray(data.candidates) ? data.candidates[0] : undefined);
    if (candidate.finishReason) {
      if (candidate.finishReason !== 'STOP') throw new RouteError(`Gemini did not complete the response (${String(candidate.finishReason)}). No tool calls executed.`, 'protocol');
      finished = true;
    }
    const incoming = object(candidate.content).parts;
    if (Array.isArray(incoming)) for (const value of incoming) {
      const part = object(value);
      if (part.thought === true) continue;
      if (typeof part.text === 'string') { text += part.text; onText(part.text); parts.push(part); }
      else if (part.functionCall) {
        const fn = object(part.functionCall);
        if (typeof fn.name !== 'string' || !/^[\w-]{1,64}$/.test(fn.name) || !fn.args || typeof fn.args !== 'object' || Array.isArray(fn.args) || calls.length >= 8) throw new RouteError('Malformed Gemini function call.', 'protocol');
        calls.push({ id: `call_${randomUUID()}`, type: 'function', function: { name: fn.name, arguments: JSON.stringify(fn.args) } });
        parts.push(part); // Preserve the opaque thoughtSignature only for this route.
      }
    }
    if (data.usageMetadata) {
      const reported = object(data.usageMetadata);
      const numeric = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
      const output = numeric(reported.candidatesTokenCount);
      usage = { inputTokens: numeric(reported.promptTokenCount), outputTokens: output === undefined ? undefined : output + (numeric(reported.thoughtsTokenCount) ?? 0) };
    }
  });
  if (!finished) throw new RouteError('Gemini stream ended before a completed response.', 'protocol');
  return { message: { role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}), providerState: { provider: 'gemini', model, parts } }, usage };
}

export class Gemini implements Connector {
  private readonly baseURL: string;
  constructor(private readonly key: string, baseURL?: string) { this.baseURL = endpoint(baseURL, 'https://generativelanguage.googleapis.com/v1beta'); }
  async models(signal = AbortSignal.timeout(15_000)): Promise<ModelInfo[]> {
    if (!this.key) throw new RouteError('Connect a Gemini API key first.', 'auth');
    const result: ModelInfo[] = [];
    let token = '';
    for (let page = 0; page < 10; page++) {
      const response = await fetch(`${this.baseURL}/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, { headers: { 'x-goog-api-key': this.key }, signal, redirect: 'error' });
      if (!response.ok) { await response.body?.cancel(); throw statusError(response.status, null); }
      const data = object(await response.json());
      if (!Array.isArray(data.models)) throw new RouteError('Malformed Gemini model catalog.', 'protocol');
      for (const value of data.models) {
        const item = object(value);
        const id = typeof item.name === 'string' ? item.name.replace(/^models\//, '') : '';
        if (supported.has(id) && Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes('generateContent') && typeof item.inputTokenLimit === 'number') result.push({ id, context: item.inputTokenLimit });
      }
      if (typeof data.nextPageToken !== 'string' || !data.nextPageToken) return result;
      token = data.nextPageToken;
    }
    throw new RouteError('Gemini catalog pagination limit reached.', 'protocol');
  }
  route(model: string): Route {
    return { id: `gemini/${model}`, provider: 'gemini', model,
      manualApproval: 'Gemini free access depends on the Google project billing tier. Robinhood cannot verify that tier or the remaining balance. This request may consume credits or incur charges.',
      complete: async (messages, signal, onText, consent) => {
        manualConsent(consent);
        const selected = (await this.models(AbortSignal.any([signal, AbortSignal.timeout(15_000)]))).find(item => item.id === model);
        if (!selected) throw new RouteError('Choose a supported Gemini model from /models gemini.', 'policy');
        const body = { ...geminiHistory(messages, model), tools: [{ functionDeclarations: toolDefinitions.map(tool => ({ name: tool.function.name, description: tool.function.description, parametersJsonSchema: tool.function.parameters })) }], generationConfig: { maxOutputTokens: 2048, thinkingConfig: { includeThoughts: false } } };
        contextBudget(body, selected.context);
        const response = await fetch(`${this.baseURL}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { method: 'POST', headers: { 'x-goog-api-key': this.key, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]), redirect: 'error' });
        return parseGemini(response, model, onText);
      },
    };
  }
}
