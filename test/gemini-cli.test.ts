import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { GeminiCliBridge, GeminiProcess, prepareGemini } from '../src/bridges/gemini-cli.js';
import { Store } from '../src/storage.js';
import { Runner } from '../src/session.js';
import { workspaceIdentity } from '../src/tools.js';

test('Gemini CLI accepts only valid structured proposals and requires account consent', async () => {
  let calls = 0;
  const bridge = new GeminiCliBridge({ run: async () => { calls++; return JSON.stringify({ response: JSON.stringify({ content: 'Done', tool_calls: [] }) }); } });
  await assert.rejects(bridge.route('gemini-2.5-flash').complete([], new AbortController().signal, () => {}), /approv|confirm/i);
  assert.equal(calls, 0);
  assert.equal((await bridge.route('gemini-2.5-flash').complete([], new AbortController().signal, () => {}, { confirmed: true })).message.content, 'Done');
  for (const response of ['plain text', '{"content":"oops","tool_calls":[{"name":"bash","arguments":"{}"}]}']) {
    const invalid = new GeminiCliBridge({ run: async () => JSON.stringify({ response }) });
    await assert.rejects(invalid.route('gemini-2.5-flash').complete([], new AbortController().signal, () => {}, { confirmed: true }));
  }
});

let installed = true;
try { createRequire(import.meta.url).resolve('@google/gemini-cli/package.json'); } catch { installed = false; }
test('real Gemini CLI disables native tools and proposes an approved Robinhood file write', { skip: !installed, timeout: 60000 }, async () => {
  const requests: Array<Record<string, any>> = [];
  const mock = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (req.url?.includes('countTokens')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ totalTokens: 50 })); return; }
    requests.push(body);
    const result = requests.length === 1 ? { content: 'Create the test file.', tool_calls: [{ name: 'write_file', arguments: JSON.stringify({ path: 'receipt.txt', content: 'once', expectedHash: null }) }] } : { content: 'Confirmed from the saved receipt.', tool_calls: [] };
    const response = { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(result) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } };
    if (req.url?.includes('streamGenerateContent')) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(`data: ${JSON.stringify(response)}\n\n`); }
    else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(response)); }
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const scratch = await mkdtemp(path.join(tmpdir(), 'robinhood-gemini-fixture-'));
  const profile = path.join(scratch, 'profile');
  const fixture = { baseURL: `http://127.0.0.1:${(mock.address() as { port: number }).port}`, apiKey: 'synthetic-fixture-key' };
  const prepared = await prepareGemini(profile, fixture);
  assert.equal(prepared.env.GEMINI_CLI_HOME, profile);
  assert.ok(prepared.args.includes('--policy'));
  const bridge = new GeminiCliBridge(new GeminiProcess(profile, fixture));
  const store = new Store(path.join(scratch, 'sessions.db'));
  const session = store.create(scratch, await workspaceIdentity(scratch), 'Create a test file once');
  let approvals = 0;
  try {
    await new Runner(store).turn(session, 'Create the test file.', [bridge.route('gemini-2.5-flash')], { text() {}, status() {}, approveRequest: async () => true,
      approve: async () => { approvals++; await assert.rejects(readFile(path.join(scratch, 'receipt.txt'))); return true; },
    }, AbortSignal.timeout(45000));
    assert.equal(await readFile(path.join(scratch, 'receipt.txt'), 'utf8'), 'once');
    assert.equal(approvals, 1); assert.equal(requests.length, 2);
    assert.ok(JSON.stringify(requests[1]).includes('once'));
    for (const request of requests) for (const tool of request.tools ?? []) assert.deepEqual(tool, { functionDeclarations: [] }, 'native Gemini tools must be absent');
  } finally { await bridge.close(); store.close(); mock.closeAllConnections(); await new Promise<void>(resolve => mock.close(() => resolve())); }
});
