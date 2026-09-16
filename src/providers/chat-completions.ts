import { createParser } from 'eventsource-parser';
import { RouteError, type Completion, type ToolCall, type Usage } from '../types.js';

export const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nonnegative = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

export async function boundedJSON(response: Response): Promise<unknown> {
  if (!response.ok) { await response.body?.cancel(); throw statusError(response.status, response.headers.get('retry-after')); }
  if (!response.body || !response.headers.get('content-type')?.includes('application/json')) throw new RouteError('Expected a JSON response.', 'protocol');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 1024 * 1024) throw new RouteError('Provider response exceeded 1 MiB.', 'protocol');
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function validateCalls(calls: ToolCall[]): void {
  if (calls.length > 8) throw new RouteError('Excessive tool calls.', 'protocol');
  const ids = new Set<string>();
  for (const call of calls) {
    if (!/^[\w.:-]{1,200}$/.test(call.id) || !/^[\w-]{1,64}$/.test(call.function.name) || ids.has(call.id)) throw new RouteError('Invalid or duplicate tool call identifier.', 'protocol');
    ids.add(call.id);
    try { JSON.parse(call.function.arguments); } catch { throw new RouteError('Incomplete tool arguments were not executed.', 'protocol'); }
  }
}

export function jsonCompletion(payload: unknown, onText: (text: string) => void): Completion {
  const data = object(payload), choice = object(Array.isArray(data.choices) ? data.choices[0] : undefined);
  if (data.error || !['stop', 'tool_calls'].includes(String(choice.finish_reason))) throw new RouteError('Provider response is incomplete or failed.', 'protocol');
  const message = object(choice.message);
  if (message.role !== 'assistant' || message.content !== null && message.content !== undefined && typeof message.content !== 'string') throw new RouteError('Malformed assistant response.', 'protocol');
  if (message.tool_calls !== undefined && message.tool_calls !== null && !Array.isArray(message.tool_calls)) throw new RouteError('Malformed tool calls.', 'protocol');
  const calls: ToolCall[] = (Array.isArray(message.tool_calls) ? message.tool_calls : []).map(value => {
    const call = object(value), fn = object(call.function);
    if (call.type !== 'function' || typeof call.id !== 'string' || typeof fn.name !== 'string' || typeof fn.arguments !== 'string') throw new RouteError('Malformed tool call.', 'protocol');
    return { id: call.id, type: 'function', function: { name: fn.name, arguments: fn.arguments } };
  });
  validateCalls(calls);
  const content = typeof message.content === 'string' ? message.content : null;
  if (content) onText(content);
  const usage = object(data.usage);
  return { message: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) }, usage: { inputTokens: nonnegative(usage.prompt_tokens), outputTokens: nonnegative(usage.completion_tokens) } };
}

export function statusError(status: number, retry: string | null): RouteError {
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
      if (data.usage || object(data.x_groq).usage) {
        const reported = object(data.usage ?? object(data.x_groq).usage);
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
    validateCalls(toolCalls);
    return { message: { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, usage };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
