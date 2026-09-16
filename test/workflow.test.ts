import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/storage.js';
import { readWorkflow, runWorkflow } from '../src/workflow.js';
import { Secrets } from '../src/privacy.js';
import { Capabilities } from '../src/capabilities.js';
import { workspaceIdentity } from '../src/tools.js';
import { RouteError, type Route } from '../src/types.js';

test('paused workflows resume without duplicating input or completed steps', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'robinhood-workflow-')));
  const filename = path.join(root, 'workflow.json');
  await writeFile(filename, JSON.stringify({ name: 'Review', steps: ['Inspect', 'Summarize'] }));
  const workflow = await readWorkflow(filename); const store = new Store(path.join(root, 'state.db')); const capabilities = new Capabilities();
  try {
    const session = store.create(root, await workspaceIdentity(root), 'Review'); store.event(session.id, 'workflow', workflow);
    let calls = 0;
    const route: Route = { id: 'fixture', provider: 'fixture', model: 'fixture', complete: async () => {
      if (++calls === 1) throw new RouteError('quota', 'quota');
      return { message: { role: 'assistant', content: 'Step completed.' } };
    } };
    const ui = { text() {}, status() {}, approve: async () => true };
    await assert.rejects(runWorkflow(store, session, route, ui, new Secrets(), capabilities, AbortSignal.timeout(5000)), /quota/);
    await runWorkflow(store, session, route, ui, new Secrets(), capabilities, AbortSignal.timeout(5000));
    assert.equal(store.messages(session.id).filter(message => message.content === 'Inspect').length, 1);
    assert.equal(store.messages(session.id).filter(message => message.content === 'Summarize').length, 1);
    assert.equal(store.state<{ status: string }>(session.id, 'workflow', { status: '' }).status, 'completed');
    assert.equal(calls, 3);
  } finally { await capabilities.close(); store.close(); }
});
