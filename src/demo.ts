import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OpenRouter } from './providers/openrouter.js';
import { Runner, type Interaction } from './session.js';
import { Store } from './storage.js';
import { workspaceIdentity } from './tools.js';

export const fixtureCommand = 'node -e "require(\'fs\').appendFileSync(\'handoff-count.txt\',\'once\\n\')"';

export async function startFixture() {
  const requests: { model: string; messages: { role: string; content: string | null }[] }[] = [];
  let first = true;
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: ['primary', 'backup'].map(name => ({ id: `fixture/${name}:free`, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'], context_length: 64000 })) }));
        return;
      }
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw) as { model: string; messages: { role: string; content: string | null }[] };
      requests.push(body);
      if (body.model === 'fixture/primary:free' && !first) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' });
        res.end(JSON.stringify({ error: { message: 'Simulated quota exhaustion' } }));
        return;
      }
      const tool = body.model === 'fixture/primary:free';
      first = false;
      const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-command-1', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: fixtureCommand }) } }] } : { role: 'assistant', content: 'The saved command receipt is in context. The command ran once; I will not repeat it.' };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': local fixture, no remote model\r\n\r\n');
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    } catch { res.writeHead(500); res.end(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not start.');
  const transport = new OpenRouter('fixture-key-not-a-credential', `http://127.0.0.1:${address.port}`);
  return {
    requests,
    routes: ['primary', 'backup'].map(name => ({ ...transport.route(`fixture/${name}:free`), id: `simulated-${name}`, provider: `simulated-${name}` })),
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}

export async function demo(print: (text: string) => void = console.log): Promise<void> {
  const workspace = await realpath(await mkdtemp(path.join(tmpdir(), 'robinhood demo ')));
  await writeFile(path.join(workspace, 'README.md'), 'Disposable Robinhood demo workspace.\n');
  const database = path.join(workspace, '.robinhood', 'sessions.db');
  const fixture = await startFixture();
  let store = new Store(database);
  try {
    print('ROBINHOOD / offline handoff demo');
    print('Two simulated providers. No account, network inference, or tokens required.');
    print(`Disposable workspace: ${workspace}`);
    const session = store.create(workspace, await workspaceIdentity(workspace), 'Run the fixture command once and preserve its receipt across a quota failure.');
    const ui: Interaction = {
      text: print,
      status: print,
      approve: async description => {
        const approved = description === `Run in ${workspace}:\n${fixtureCommand}`;
        print(approved ? 'Approved the fixed demo command in its disposable workspace.' : 'Denied an unexpected operation.');
        return approved;
      },
    };
    await new Runner(store).turn(session, session.objective, fixture.routes, ui, AbortSignal.timeout(20_000));
    assert.equal(await readFile(path.join(workspace, 'handoff-count.txt'), 'utf8'), 'once\n');
    assert.equal(fixture.requests.length, 3);
    assert.ok(fixture.requests[2]!.messages.some(message => message.role === 'tool' || message.content?.includes('Historical tool receipt')));
    store.close();
    store = new Store(database);
    assert.equal(store.operations(session.id).filter(op => op.state === 'completed').length, 1);
    assert.ok(store.messages(session.id).some(message => message.role === 'tool'));
    print('PASS: quota handoff preserved the tool result; one command execution; session reopened from SQLite.');
    print(`Session: ${session.id}`);
    print('Demo files are retained in the disposable workspace for inspection.');
  } finally { store.close(); await fixture.close(); }
}
