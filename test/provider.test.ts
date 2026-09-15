import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { freeModels, OpenRouter, parseCompletion } from '../src/providers/openrouter.js';
import { RouteError } from '../src/types.js';

const model = { id: 'test/model:free', pricing: { prompt: '0', completion: '0' }, context_length: 64000, supported_parameters: ['tools'] };
const sse = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const end = sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n';
function stream(parts: string[]): Response {
  return new Response(new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(new TextEncoder().encode(part)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}

test('free route filter rejects missing/unknown prices, ancillary charges, and missing tools', () => {
  assert.deepEqual(freeModels({ data: [model] }), [{ id: model.id, context: 64000 }]);
  for (const changed of [
    { ...model, id: 'test/paid' }, { ...model, pricing: {} },
    { ...model, pricing: { prompt: '', completion: '0' } },
    { ...model, pricing: { prompt: '0', completion: '0', request: '0.01' } },
    { ...model, pricing: { prompt: '0', completion: '0', new_charge: 'unknown' } },
    { ...model, supported_parameters: [] },
  ]) assert.deepEqual(freeModels({ data: [changed] }), []);
});

test('SSE accepts comments, fragmented fields, UTF-8, and a usage-only final frame', async () => {
  const data = ': keepalive\r\n\r\n' + sse({ choices: [{ delta: { content: 'Hello 🌍' }, finish_reason: null }] }) + sse({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }) + end;
  let seen = '';
  const completion = await parseCompletion(stream([...data]), text => { seen += text; });
  // Split by bytes separately to exercise an actual multi-byte code point boundary.
  const bytes = new TextEncoder().encode(data);
  const byteStream = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
  assert.equal((await parseCompletion(byteStream, () => {})).message.content, 'Hello 🌍');
  assert.equal(seen, 'Hello 🌍');
  assert.equal(completion.usage!.inputTokens, 12);
});

test('missing completion marker, mid-stream errors, malformed JSON, and partial tool calls fail closed', async () => {
  const cases = [
    sse({ choices: [{ delta: { content: 'Partial' }, finish_reason: null }] }),
    sse({ error: { code: 429 } }),
    'data: {broken}\n\n',
    sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'tool', function: { name: 'write_file', arguments: '{' } }] }, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n',
    sse({ choices: [{ delta: {}, finish_reason: 'length' }] }) + 'data: [DONE]\n\n',
  ];
  for (const data of cases) await assert.rejects(parseCompletion(stream([data]), () => {}));
});

test('429 is surfaced once with Retry-After; there are no transport retries', async () => {
  let requests = 0;
  const server = createServer((req, res) => {
    if (req.url === '/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [model] })); return; }
    requests++;
    res.writeHead(429, { 'retry-after': '13' }); res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address() as { port: number };
  try {
    const client = new OpenRouter('fixture', `http://127.0.0.1:${address.port}`);
    await assert.rejects(client.route(model.id).complete([], new AbortController().signal, () => {}), error => error instanceof RouteError && error.kind === 'quota' && error.retryAfterMs === 13000);
    assert.equal(requests, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('a free route changing price is blocked before the next inference request', async () => {
  let paid = false;
  let inference = 0;
  const server = createServer((req, res) => {
    if (req.url === '/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ ...model, pricing: { prompt: '0', completion: paid ? '0.01' : '0' } }] })); return; }
    inference++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(sse({ choices: [{ delta: { content: 'Completed' }, finish_reason: null }] }) + end);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address() as { port: number };
  try {
    const route = new OpenRouter('fixture', `http://127.0.0.1:${address.port}`).route(model.id);
    await route.complete([], new AbortController().signal, () => {});
    paid = true;
    await assert.rejects(route.complete([], new AbortController().signal, () => {}), /verified free/);
    assert.equal(inference, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
