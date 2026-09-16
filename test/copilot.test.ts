import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { CopilotBridge, CopilotProcess, prepareCopilot, copilotSafetyArgs, copilotResponse } from '../src/bridges/copilot.js';
import { Store } from '../src/storage.js';
import { Runner } from '../src/session.js';
import { workspaceIdentity } from '../src/tools.js';

test('Copilot requires explicit account consent before starting its CLI', async () => {
  let calls = 0;
  const bridge = new CopilotBridge({ run: async () => { calls++; return '{}'; } });
  await assert.rejects(bridge.route('claude-haiku-4.5').complete([], new AbortController().signal, () => {}), /approv|confirm/i);
  assert.equal(calls, 0);
  assert.ok(copilotSafetyArgs.includes('--available-tools=robinhood_no_native_tools'));
  assert.ok(!copilotSafetyArgs.includes('--allow-all-tools'));
});

let installed = true;
try { createRequire(import.meta.url).resolve('@github/copilot/package.json'); } catch { installed = false; }
test('real Copilot CLI uses stdin history without native tools and returns approved proposals', { skip: !installed, timeout: 60000 }, async () => {
  const requests: Array<Record<string, any>> = [];
  const mock = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'claude-haiku-4.5' }] })); return; }
    requests.push(body);
    const result = requests.length === 1 ? { content: 'Create the test file.', tool_calls: [{ name: 'write_file', arguments: JSON.stringify({ path: 'receipt.txt', content: 'once', expectedHash: null }) }] } : { content: 'Confirmed from the saved receipt.', tool_calls: [] };
    const base = { id: 'fixture', object: 'chat.completion', created: 0, model: body.model, usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: null }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ...base, choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: 'stop' }] })); }
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const scratch = await mkdtemp(path.join(tmpdir(), 'robinhood-copilot-fixture-'));
  const profile = path.join(scratch, 'profile');
  const fixture = { baseURL: `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1` };
  const prepared = await prepareCopilot(profile, fixture);
  assert.equal(prepared.env.COPILOT_HOME, profile);
  assert.equal(prepared.env.GITHUB_TOKEN, undefined);
  const bridge = new CopilotBridge(new CopilotProcess(profile, fixture));
  const store = new Store(path.join(scratch, 'sessions.db'));
  const session = store.create(scratch, await workspaceIdentity(scratch), 'Create a test file once');
  let approvals = 0;
  try {
    await new Runner(store).turn(session, 'Create the test file.', [bridge.route('claude-haiku-4.5')], { text() {}, status() {}, approveRequest: async () => true,
      approve: async () => { approvals++; await assert.rejects(readFile(path.join(scratch, 'receipt.txt'))); return true; },
    }, AbortSignal.timeout(45000));
    assert.equal(await readFile(path.join(scratch, 'receipt.txt'), 'utf8'), 'once');
    assert.equal(approvals, 1); assert.equal(requests.length, 2);
    assert.ok(JSON.stringify(requests[0]).includes('Create the test file.'));
    assert.ok(JSON.stringify(requests[1]).includes('once'));
    for (const request of requests) assert.ok(!request.tools?.length, `native Copilot tools must be absent: ${request.tools?.map((tool: any) => tool.function?.name).join(', ')}`);
  } finally { await bridge.close(); store.close(); mock.closeAllConnections(); await new Promise<void>(resolve => mock.close(() => resolve())); }
});

test('Copilot event parsing requires completion and rejects native tool activity', () => {
  const message = JSON.stringify({type: 'assistant.message', data: {content: '{"content":"Done","tool_calls":[]}', toolRequests: []}});
  const done = JSON.stringify({type: 'result', exitCode: 0});
  assert.equal(JSON.parse(copilotResponse(message + '\n' + done)).response, '{"content":"Done","tool_calls":[]}');
  for (const raw of [message, 'not JSON', message + '\n' + JSON.stringify({type:'result', exitCode:1}), JSON.stringify({type:'tool.execution_start'}) + '\n' + message + '\n' + done]) assert.throws(() => copilotResponse(raw));
});
