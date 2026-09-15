import { createParser } from 'eventsource-parser';
import { RouteError } from '../types.js';
import { statusError } from './chat-completions.js';

export function endpoint(override: string | undefined, expected: string): string {
  if (!override || override === expected) return expected;
  const url = new URL(override);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Endpoint overrides are restricted to loopback test servers.');
  return override.replace(/\/$/, '');
}

export async function events(response: Response, receive: (data: unknown) => void): Promise<void> {
  if (!response.ok) { await response.body?.cancel(); throw statusError(response.status, response.headers.get('retry-after')); }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new RouteError('Expected a provider event stream.', 'protocol');
  const parser = createParser({ maxBufferSize: 128 * 1024, onError: () => { throw new RouteError('Malformed provider event stream.', 'protocol'); }, onEvent: event => { if (event.data !== '[DONE]') receive(JSON.parse(event.data)); } });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 1024 * 1024) throw new RouteError('Provider response exceeded 1 MiB.', 'protocol');
      parser.feed(decoder.decode(chunk.value, { stream: true }));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function manualConsent(consent?: { confirmed: boolean }): void {
  if (!consent?.confirmed) throw new RouteError('This account-dependent route requires explicit approval for each request. Its free balance and billing tier cannot be verified.', 'policy');
}

export function contextBudget(body: unknown, context: number): void {
  if (Buffer.byteLength(JSON.stringify(body)) + 4096 > Math.min(context, 64000)) throw new RouteError('Session exceeds the conservative context budget. No request was sent.', 'policy');
}
