import { createParser } from 'eventsource-parser';
import { RouteError, type Completion, type ToolCall, type Usage } from '../types.js';

export const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nonnegative = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

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
    const ids = new Set<string>();
    for (const call of toolCalls) {
      if (!/^[\w.:-]{1,200}$/.test(call.id) || !/^[\w-]{1,64}$/.test(call.function.name) || ids.has(call.id)) throw new RouteError('Invalid or duplicate tool call identifier.', 'protocol');
      ids.add(call.id);
      try { JSON.parse(call.function.arguments); } catch { throw new RouteError('Incomplete tool arguments were not executed.', 'protocol'); }
    }
    return { message: { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, usage };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
