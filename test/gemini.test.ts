import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Gemini, geminiHistory, parseGemini } from '../src/providers/gemini.js';
import { chatMessages } from '../src/providers/memory.js';
import { Runner } from '../src/session.js';
import { Store } from '../src/storage.js';
import { workspaceIdentity } from '../src/tools.js';
import type { Message } from '../src/types.js';

const model = 'gemini-3.8-flash';
const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const response = (data: string) => new Response(data, { headers: { 'content-type': 'text/event-stream' } });
const toolPart = { functionCall: { name: 'write_file', args: { path: 'gemini.txt', content: 'written once', expectedHash: null } }, thoughtSignature: 'opaque-fixture-signature' };

test('Gemini preserves native signatures locally and does not export them to another provider', async () => {
  const parsed = await parseGemini(response(event({ candidates: [{ content: { parts: [{ thought: true, text: 'private reasoning' }, toolPart] }, finishReason: 'STOP' }] })), model, () => {});
  parsed.message.source = { provider: 'gemini', model };
  const history: Message[] = [parsed.message, { role: 'tool', tool_call_id: parsed.message.tool_calls![0]!.id, content: 'write completed' }];
  assert.deepEqual(geminiHistory(history, model).contents[0]!.parts[0], toolPart);
  assert.match(JSON.stringify(geminiHistory(history, model)), /functionResponse/);
  const foreign = JSON.stringify(chatMessages(history, 'openrouter', 'other/model:free'));
  assert.match(foreign, /write completed/);
  assert.doesNotMatch(foreign, /opaque-fixture-signature|private reasoning|providerState/);
});

test('Gemini rejects a missing finish marker, safety termination, and malformed function arguments', async () => {
  for (const data of [
    { candidates: [{ content: { parts: [{ text: 'partial' }] } }] },
    { candidates: [{ finishReason: 'SAFETY' }] },
    { candidates: [{ content: { parts: [{ functionCall: { name: 'write_file', args: 'bad' } }] }, finishReason: 'STOP' }] },
  ]) await assert.rejects(parseGemini(response(event(data)), model, () => {}));
});

test('Gemini tool round-trip uses approval, persists its receipt, and carries native signatures', async () => {
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith('/models?')) {
      assert.equal(req.headers['x-goog-api-key'], 'fixture-key');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ models: [{ name: `models/${model}`, supportedGenerationMethods: ['generateContent'], inputTokenLimit: 128000 }] }));
      return;
    }
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body) as Record<string, unknown>);
    res.setHeader('content-type', 'text/event-stream');
    res.end(event({ candidates: [{ content: { parts: requests.length === 1 ? [toolPart] : [{ text: 'Done.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 5 } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'robinhood gemini ')));
  const store = new Store(path.join(directory, 'sessions.db'));
  try {
    const session = store.create(directory, await workspaceIdentity(directory), 'Write one file.');
    const route = new Gemini('fixture-key', `http://127.0.0.1:${(server.address() as { port: number }).port}`).route(model);
    await assert.rejects(route.complete([], new AbortController().signal, () => {}), /approval/);
    assert.equal(requests.length, 0);
    let confirmations = 0;
    await new Runner(store).turn(session, 'Write one file.', [route], { text() {}, status() {}, approve: async () => true, approveRequest: async () => { confirmations++; return true; } }, new AbortController().signal);
    assert.equal(requests.length, 2);
    assert.equal(confirmations, 2);
    assert.equal(await readFile(path.join(directory, 'gemini.txt'), 'utf8'), 'written once');
    assert.match(JSON.stringify(requests[1]), /opaque-fixture-signature/);
    assert.match(JSON.stringify(requests[1]), /functionResponse/);
    assert.equal(store.operations(session.id)[0]!.state, 'completed');
  } finally { store.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('foreign tool receipts enter Gemini as historical data, not unsigned native calls', () => {
  const history: Message[] = [
    { role: 'assistant', source: { provider: 'openrouter', model: 'a:free' }, content: null, tool_calls: [{ id: 'old', type: 'function', function: { name: 'run_command', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'old', content: 'test passed' },
  ];
  const serialized = JSON.stringify(geminiHistory(history, model));
  assert.match(serialized, /test passed/);
  assert.doesNotMatch(serialized, /functionCall|functionResponse/);
});
