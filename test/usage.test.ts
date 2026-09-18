import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/storage.js';
import { usageSummary } from '../src/usage.js';

test('usage combines legacy and attributed events, keeps missing reports visible and does not count forked history twice', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rh-usage-'));
  const store = new Store(path.join(root, 'state.db'));
  try {
    const task = store.create(root, 'fixture', 'Usage fixture');
    store.selectRoute(task.id, 'one/model');
    store.event(task.id, 'request-attempt', { route: 'one/model' });
    store.event(task.id, 'usage', { inputTokens: 100, outputTokens: 25 });
    store.event(task.id, 'request-attempt', { route: 'two/model' });
    store.event(task.id, 'request-error', { route: 'two/model' });
    store.event(task.id, 'usage', { provider: 'other', model: 'summary', inputTokens: 20, outputTokens: 5 });
    store.fork(task.id);
    const summary = usageSummary(store);
    assert.deepEqual(summary.total, { input: 120, output: 30, requests: 2, reported: 2, failures: 1 });
    assert.equal(summary.providers.one?.input, 100);
    assert.equal(summary.providers.two?.failures, 1);
    assert.equal(summary.providers.other?.output, 5);
    assert.equal(usageSummary(store, 'different workspace').total.input, 0);
  } finally { store.close(); }
});
