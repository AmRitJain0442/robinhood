import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/storage.js';
import { Runner } from '../src/session.js';
import { Capabilities } from '../src/capabilities.js';
import { workspaceIdentity } from '../src/tools.js';
import { systemPrompt, systemPromptHash } from '../src/prompt.js';
import type { Route } from '../src/types.js';

test('plan mode blocks hallucinated write tools and sends the user-derived prompt', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'robinhood-plan-')));
  const store = new Store(path.join(root, 'state.db'));
  try {
    const session = store.create(root, await workspaceIdentity(root), 'Plan only');
    store.event(session.id, 'plan-mode', true);
    let calls = 0;
    const route: Route = { id: 'fixture', provider: 'fixture', model: 'fixture', complete: async (messages, _signal, _text, _consent, options) => {
      assert.ok(messages[0]?.content?.includes(systemPrompt));
      assert.ok(!options?.tools?.some(tool => tool.function.name === 'write_file'));
      return { message: ++calls === 1 ? { role: 'assistant', content: '', tool_calls: [{ id: 'blocked', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'bad.txt', content: 'no', expectedHash: null }) } }] } : { role: 'assistant', content: 'Plan ready.' } };
    } };
    await new Runner(store).turn(session, 'Inspect first', [route], { text() {}, status() {}, approve: async () => { throw new Error('Must reject before approval'); } }, AbortSignal.timeout(5000));
    await assert.rejects(readFile(path.join(root, 'bad.txt')));
    assert.match(store.operations(session.id)[0]!.result!, /Plan mode/);
    assert.ok(JSON.stringify(store.events(session.id)).includes(systemPromptHash));
  } finally { store.close(); }
});

test('fork and compaction preserve original history and completed receipts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'robinhood-memory-'));
  const store = new Store(path.join(root, 'state.db'));
  try {
    const session = store.create(root, 'fixture', 'Original');
    store.append(session.id, { role: 'user', content: 'Do it once' });
    const [op] = store.prepare(session.id, { role: 'assistant', content: '', tool_calls: [{ id: 'once', type: 'function', function: { name: 'run_command', arguments: '{"command":"echo once"}' } }] });
    assert.throws(() => store.fork(session.id), /pending/);
    store.running(op!.id); store.finish(op!.id, 'completed', 'once');
    const original = store.messages(session.id);
    store.compact(session.id, original.length, 'Command completed once.');
    const child = store.fork(session.id, 'Explore alternative');
    assert.deepEqual(store.messages(session.id), original);
    assert.equal(store.context(child.id).length, 1);
    assert.equal(store.operations(child.id)[0]?.state, 'completed');
    assert.notEqual(store.operations(child.id)[0]?.id, op!.id);
    assert.throws(() => store.prepare(child.id, original[1]!), /reused/);
    store.append(child.id, { role: 'user', content: 'New branch' });
    assert.equal(store.messages(session.id).length, original.length);
  } finally { store.close(); }
});

test('checklists validate items and cannot create a user goal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'robinhood-tasks-'));
  const store = new Store(path.join(root, 'state.db'));
  try {
    const session = store.create(root, 'fixture', 'Task');
    const capabilities = new Capabilities();
    const context = { store, session };
    await assert.rejects(capabilities.prepare(context, 'goal_complete', '{"evidence":"looks fine"}'), /No active/);
    await assert.rejects(capabilities.prepare(context, 'todo_write', '{"items":[{"id":"x","text":"task","status":"fiction"}]}'), /Invalid/);
    const prepared = await capabilities.prepare(context, 'todo_write', '{"items":[{"id":"x","text":"Inspect","status":"in_progress"}]}');
    assert.deepEqual(store.state(session.id, 'todos', []), []);
    await prepared.execute(AbortSignal.timeout(1000));
    assert.equal(store.state<Array<{ status: string }>>(session.id, 'todos', [])[0]?.status, 'in_progress');
  } finally { store.close(); }
});
