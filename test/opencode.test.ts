import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { OpenCodeBridge, OpenCodeProcess, engineConfig, engineCompletion, freeEngineModels, type Engine } from '../src/bridges/opencode.js';
import { KiloBridge, KiloProcess, kiloConfig, kiloModels } from '../src/bridges/kilo.js';
import { Store } from '../src/storage.js';
import { Runner } from '../src/session.js';
import { workspaceIdentity } from '../src/tools.js';

function catalog(price: unknown = 0) {
  return { all: [{ id: 'opencode', models: { 'big-pickle': { id: 'big-pickle', capabilities: { toolcall: true }, cost: { input: price, output: 0, cache: { read: 0, write: 0 } }, limit: { context: 128000 } } } }] };
}
test('OpenCode bridge rejects unknown prices, paid models, unsupported models, and missing tool capability', () => {
  assert.equal(freeEngineModels(catalog()).length, 1);
  for (const price of [1, undefined, '0', null]) {
    const data = catalog(); data.all[0]!.models['big-pickle'].cost.input = price;
    assert.deepEqual(freeEngineModels(data), []);
  }
  const data = catalog(); data.all[0]!.models['big-pickle'].id = 'paid-model';
  assert.deepEqual(freeEngineModels(data), []);
  data.all[0]!.models['big-pickle'].id = 'big-pickle'; data.all[0]!.models['big-pickle'].capabilities.toolcall = false;
  assert.deepEqual(freeEngineModels(data), []);
});

test('OpenCode rechecks access before sending memory and rejects withdrawn free access', async () => {
  let price = 0; const requests: string[] = [];
  const engine: Engine = { request: async route => { requests.push(route); return catalog(price); }, close: async () => {} };
  const bridge = new OpenCodeBridge(() => engine);
  await bridge.models(); price = 1;
  await assert.rejects(bridge.route('big-pickle').complete([], new AbortController().signal, () => {}, { confirmed: true }), /no longer/);
  assert.deepEqual(requests, ['/provider', '/provider']);
  await assert.rejects(bridge.route('big-pickle').complete([], new AbortController().signal, () => {}), /confirm|approv/i);
});

test('OpenCode malformed structured responses never become executable tools', () => {
  for (const structured of [{ content: 'ok', tool_calls: [{ name: 'bash', arguments: '{}' }] }, { content: 'ok', tool_calls: [{ name: 'run_command', arguments: 'not JSON' }] }, { content: 'ok', tool_calls: [{ name: 'run_command', arguments: 'null' }] }, {}]) {
    assert.throws(() => engineCompletion({ info: { structured } }));
  }
  assert.throws(() => engineCompletion({ info: { error: { name: 'APIError' } } }));
  assert.throws(() => engineCompletion({ info: { structured: { content: '', tool_calls: [] } } }), /empty response/);
});

test('OpenCode cancellation closes the owned engine and allows a fresh connection', async () => {
  let closed = 0, created = 0;
  const bridge = new OpenCodeBridge(() => { created++; return {
    async request(route, _method, _body, signal) {
      if (route === '/provider') return catalog();
      if (route === '/session') return { id: 'ses_test' };
      return new Promise((_, reject) => signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    }, async close() { closed++; },
  }; });
  const controller = new AbortController();
  const request = bridge.route('big-pickle').complete([], controller.signal, () => {}, { confirmed: true });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(request, /cancelled/); assert.equal(closed, 1);
  await bridge.models(); assert.equal(created, 2); await bridge.close();
});

for (const variant of [
  { name: 'OpenCode', packageName: 'opencode-ai', providerID: 'opencode', model: 'big-pickle', config: engineConfig,
    bridge: (config: unknown) => new OpenCodeBridge(() => new OpenCodeProcess(config)) },
  { name: 'Kilo', packageName: '@kilocode/cli', providerID: 'kilo', model: 'robinhood/fixture:free', config: kiloConfig,
    bridge: (config: unknown) => new KiloBridge(() => new KiloProcess(config)) },
]) {
let installed = true;
try { createRequire(import.meta.url).resolve(`${variant.packageName}/package.json`); } catch { installed = false; }
test(`real ${variant.name} CLI routes a structured tool through Robinhood approval and retains its receipt`, { skip: !installed, timeout: 60000 }, async () => {
  const requests: Array<Record<string, any>> = [];
  const mock = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: variant.model, name: 'Fixture', context_length: 128000, supported_parameters: ['tools'], architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0', input_cache_read: '0', input_cache_write: '0' } }] })); return;
    }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    if (requests.length > 4) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Unexpected extra engine request' } })); return; }
    const result = requests.length === 1 ? { content: 'Create the fixture file.', tool_calls: [{ name: 'write_file', arguments: JSON.stringify({ path: 'receipt.txt', content: 'once', expectedHash: null }) }] } : { content: 'The saved receipt confirms the file was created.', tool_calls: [] };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta: unknown, finish_reason: string | null = null) => ({ id: 'fixture', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason }] });
    res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `structured-${requests.length}`, type: 'function', function: { name: 'StructuredOutput', arguments: JSON.stringify(result) } }] }))}\n\n`);
    res.write(`data: ${JSON.stringify(chunk({}, 'tool_calls'))}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const config = variant.config();
  const fixture = { ...config, provider: { [variant.providerID]: {
    npm: '@ai-sdk/openai-compatible', whitelist: [variant.model],
    options: { baseURL: `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`, apiKey: 'synthetic-fixture', maxRetries: 0 },
    models: { [variant.model]: { name: 'Fixture', limit: { context: 128000, output: 4096 }, tool_call: true, cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 } } },
  } } };
  const bridge = variant.bridge(fixture);
  const scratch = await mkdtemp(path.join(tmpdir(), 'robinhood-bridge-test-'));
  const store = new Store(path.join(scratch, 'sessions.db'));
  const session = store.create(scratch, await workspaceIdentity(scratch), 'Create the fixture file once.');
  let approvals = 0;
  try {
    await new Runner(store).turn(session, 'Create receipt.txt with once.', [bridge.route(variant.model)], {
      text() {}, status() {}, approveRequest: async () => true,
      approve: async () => { approvals++; await assert.rejects(readFile(path.join(scratch, 'receipt.txt'))); return true; },
    }, AbortSignal.timeout(45000));
    assert.equal(await readFile(path.join(scratch, 'receipt.txt'), 'utf8'), 'once');
    assert.equal(approvals, 1); assert.equal(requests.length, 2);
    assert.ok(JSON.stringify(requests[1]!.messages).includes('once'));
    for (const request of requests) {
      assert.equal(request.model, variant.model);
      assert.ok(request.tools.some((tool: any) => tool.function.name === 'StructuredOutput'));
      assert.ok(!request.tools.some((tool: any) => ['bash', 'write', 'edit', 'task', 'read'].includes(tool.function.name)));
    }
    assert.equal(store.operations(session.id).filter(op => op.state === 'completed').length, 1);
  } finally {
    await bridge.close(); store.close(); mock.closeAllConnections(); await new Promise<void>(resolve => mock.close(() => resolve()));
  }
});
}

test('Kilo excludes automatic routers even when they advertise zero prices', () => {
  const data = catalog(); data.all[0]!.id = 'kilo';
  const model = data.all[0]!.models['big-pickle'];
  for (const id of ['kilo-auto/free', 'openrouter/auto', 'openrouter/free', 'auto/model:free']) {
    model.id = id; assert.deepEqual(kiloModels(data), []);
  }
  model.id = 'vendor/model:free'; assert.equal(kiloModels(data).length, 1);
});
