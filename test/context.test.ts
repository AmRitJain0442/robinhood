import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/storage.js';
import { compactSession } from '../src/context.js';
import { delegateTask } from '../src/delegation.js';
import { Secrets } from '../src/privacy.js';
import { Capabilities } from '../src/capabilities.js';
import { workspaceIdentity } from '../src/tools.js';
import type { Route } from '../src/types.js';

test('compaction requires review and explicitly disables model tools', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'robinhood-compact-')); const store = new Store(path.join(root, 'state.db'));
  try {
    const session = store.create(root, 'fixture', 'Task'); store.append(session.id, { role: 'user', content: 'Remember constraints' });
    const route: Route = { id: 'fixture', provider: 'fixture', model: 'fixture', complete: async (_messages, _signal, _text, _consent, options) => { assert.deepEqual(options?.tools, []); return { message: { role: 'assistant', content: 'Keep the constraint.' } }; } };
    await compactSession(store, session, route, { text() {}, status() {}, approve: async () => false }, new Secrets(), AbortSignal.timeout(1000));
    assert.equal(store.state(session.id, 'context-compacted', null), null);
    await compactSession(store, session, route, { text() {}, status() {}, approve: async () => true }, new Secrets(), AbortSignal.timeout(1000));
    assert.equal(store.messages(session.id)[0]?.content, 'Remember constraints');
    assert.match(store.context(session.id)[0]!.content!, /Keep the constraint/);
  } finally { store.close(); }
});

test('delegated research preserves parent history and restricts the child tool catalog', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'robinhood-delegate-'))); const store = new Store(path.join(root, 'state.db'));
  const capabilities = new Capabilities();
  try {
    const parent = store.create(root, await workspaceIdentity(root), 'Parent task');
    store.append(parent.id, { role: 'user', content: 'Keep my requirements' });
    const route: Route = { id: 'fixture', provider: 'fixture', model: 'fixture', complete: async (_messages, _signal, _text, _consent, options) => {
      assert.ok(!options?.tools?.some(tool => ['write_file', 'run_command', 'job_start'].includes(tool.function.name)));
      return { message: { role: 'assistant', content: 'Verified research report.' } };
    } };
    const child = await delegateTask(store, parent, 'Inspect the design', route, { text() {}, status() {}, approve: async () => false }, new Secrets(), capabilities, AbortSignal.timeout(3000));
    assert.notEqual(child.id, parent.id);
    assert.equal(store.messages(parent.id)[0]?.content, 'Keep my requirements');
    assert.match(store.messages(parent.id).at(-1)!.content!, /Verified research report/);
  } finally { await capabilities.close(); store.close(); }
});
