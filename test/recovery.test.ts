import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Store } from '../src/storage.js';
import { Runner } from '../src/session.js';
import { demo } from '../src/demo.js';
import { workspaceIdentity } from '../src/tools.js';
import type { Message, Route } from '../src/types.js';

const workspace = async () => realpath(await mkdtemp(path.join(tmpdir(), 'robinhood recovery test ')));
const ui = { text() {}, status() {}, approve: async () => true };

test('quota after a completed tool preserves context, executes once, and reopens the database', { timeout: 30_000 }, async () => {
  const output: string[] = [];
  await demo(text => output.push(text));
  assert.ok(output.some(line => line.startsWith('PASS:')));
});

test('a real process crash after the side effect becomes unknown and blocks model calls', { timeout: 20_000 }, async () => {
  const directory = await workspace();
  const child = spawn(process.execPath, [fileURLToPath(new URL('./crash-worker.js', import.meta.url)), directory], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stderr.on('data', data => { output += data; });
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 91, output);
  const store = new Store(path.join(directory, '.robinhood', 'sessions.db'));
  try {
    const session = store.get(await readFile(path.join(directory, 'session-id.txt'), 'utf8'));
    const [operation] = store.operations(session.id);
    assert.equal(operation!.state, 'unknown');
    assert.equal(await readFile(path.join(directory, 'handoff-count.txt'), 'utf8'), 'once\n');
    let calls = 0;
    const route: Route = { id: 'after-crash', provider: 'fixture', model: 'fixture', complete: async () => { calls++; return { message: { role: 'assistant', content: 'User reconciliation received.' } }; } };
    const runner = new Runner(store);
    await assert.rejects(runner.turn(session, undefined, [route], ui, new AbortController().signal), /unknown outcome/);
    assert.equal(calls, 0);
    store.finish(operation!.id, 'completed', 'User checked the receipt file: command completed once.');
    await runner.turn(session, undefined, [route], ui, new AbortController().signal);
    assert.equal(calls, 1);
    assert.equal(await readFile(path.join(directory, 'handoff-count.txt'), 'utf8'), 'once\n');
  } finally { store.close(); }
});

test('prepared operations are cancelled on restart and a second live writer is rejected', async () => {
  const directory = await workspace();
  const filename = path.join(directory, 'sessions.db');
  let store = new Store(filename);
  try {
    const session = store.create(directory, await workspaceIdentity(directory), 'Prepared only.');
    assert.throws(() => new Store(filename), /already open/);
    store.prepare(session.id, { role: 'assistant', content: null, tool_calls: [{ id: 'not-started', type: 'function', function: { name: 'run_command', arguments: '{}' } }] });
    store.close();
    store = new Store(filename);
    assert.equal(store.operations(session.id)[0]!.state, 'failed');
    assert.match(store.messages(session.id)[1]!.content!, /No action was launched/);
    assert.throws(() => store.finish(store.operations(session.id)[0]!.id, 'completed', 'duplicate'), /already settled/);
  } finally { store.close(); }
});

test('denying a command records a receipt without launching it', async () => {
  const directory = await workspace();
  const store = new Store(path.join(directory, 'sessions.db'));
  try {
    const session = store.create(directory, await workspaceIdentity(directory), 'Deny side effect.');
    let calls = 0;
    const route: Route = {
      id: 'denial-fixture', provider: 'fixture', model: 'fixture',
      complete: async () => ++calls === 1
        ? { message: { role: 'assistant', content: null, tool_calls: [{ id: 'denied', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'denied.txt', content: 'should not exist', expectedHash: null }) } }] } }
        : { message: { role: 'assistant', content: 'The operation was denied.' } },
    };
    await new Runner(store).turn(session, 'Try.', [route], { ...ui, approve: async () => false }, new AbortController().signal);
    assert.equal(await readFile(path.join(directory, 'denied.txt')).then(() => true, () => false), false);
    assert.equal(store.operations(session.id)[0]!.state, 'failed');
    assert.match(store.operations(session.id)[0]!.result!, /denied/);
  } finally { store.close(); }
});

test('failed partial output is retained as an event and never becomes a completed tool call', async () => {
  const directory = await workspace();
  const store = new Store(path.join(directory, 'sessions.db'));
  try {
    const session = store.create(directory, await workspaceIdentity(directory), 'Keep partial output separate.');
    const route: Route = { id: 'partial', provider: 'fixture', model: 'fixture', complete: async (_messages, _signal, onText) => { onText('Unfinished answer'); throw new Error('Disconnected'); } };
    await assert.rejects(new Runner(store).turn(session, 'Start.', [route], ui, new AbortController().signal), /Disconnected/);
    assert.equal(store.messages(session.id).length, 1);
    assert.equal(store.operations(session.id).length, 0);
    assert.ok(store.events(session.id).some(event => event.kind === 'incomplete-output'));
  } finally { store.close(); }
});

test('receipt persistence failure prevents any subsequent model or tool work', async () => {
  const directory = await workspace();
  const store = new Store(path.join(directory, 'sessions.db'));
  try {
    const session = store.create(directory, await workspaceIdentity(directory), 'Persistence failure.');
    let requests = 0;
    const message: Message = { role: 'assistant', content: null, tool_calls: [{ id: 'write', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'written.txt', expectedHash: null, content: 'one' }) } }] };
    const route: Route = { id: 'fixture', provider: 'fixture', model: 'fixture', complete: async () => { requests++; return { message }; } };
    store.finish = () => { throw new Error('Injected disk failure'); };
    await assert.rejects(new Runner(store).turn(session, 'Start.', [route], ui, new AbortController().signal), /disk failure/);
    assert.equal(requests, 1);
    assert.equal(await readFile(path.join(directory, 'written.txt'), 'utf8'), 'one');
    assert.equal(store.operations(session.id)[0]!.state, 'running');
  } finally { store.close(); }
});

test('reusing a completed tool-call ID is rejected without replay or an orphan message', async () => {
  const directory = await workspace();
  const store = new Store(path.join(directory, 'sessions.db'));
  try {
    const session = store.create(directory, await workspaceIdentity(directory), 'Reject replay.');
    const message: Message = { role: 'assistant', content: null, tool_calls: [{ id: 'same-call', type: 'function', function: { name: 'run_command', arguments: '{}' } }] };
    const [op] = store.prepare(session.id, message);
    store.running(op!.id);
    store.finish(op!.id, 'completed', 'Observed receipt.');
    assert.throws(() => store.prepare(session.id, message), /reused a tool-call ID/);
    assert.equal(store.messages(session.id).length, 2);
    assert.equal(store.operations(session.id).length, 1);
  } finally { store.close(); }
});

test('a changed workspace identity blocks requests until explicitly reconciled', async () => {
  const directory = await workspace();
  const store = new Store(path.join(directory, 'sessions.db'));
  try {
    let session = store.create(directory, 'old-identity', 'Preserve the task after a checkout change.');
    let calls = 0;
    const route: Route = { id: 'fixture', provider: 'fixture', model: 'fixture', complete: async () => { calls++; return { message: { role: 'assistant', content: 'I will re-read the changed files.' } }; } };
    const runner = new Runner(store);
    await assert.rejects(runner.turn(session, undefined, [route], ui, new AbortController().signal), /reconcile/);
    assert.equal(calls, 0);
    session = store.reconcileWorkspace(session.id, await workspaceIdentity(directory));
    await runner.turn(session, undefined, [route], ui, new AbortController().signal);
    assert.equal(calls, 1);
    assert.equal(session.objective, 'Preserve the task after a checkout change.');
    assert.match(store.messages(session.id)[0]!.content!, /Re-read relevant files/);
  } finally { store.close(); }
});
