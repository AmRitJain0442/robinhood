import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Jobs } from '../src/jobs.js';
import { Store } from '../src/storage.js';

test('background jobs stop, persist their outcome and cannot be stopped across sessions', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'robinhood-jobs-')));
  const store = new Store(path.join(root, 'state.db'));
  const jobs = new Jobs();
  try {
    const first = store.create(root, 'fixture', 'First');
    const second = store.create(root, 'fixture', 'Second');
    const job = jobs.start(store, first, 'node -e "setInterval(()=>{},1000)"');
    await assert.rejects(jobs.stop(store, second, job.id), /does not own/);
    await jobs.close();
    assert.equal(jobs.list(store, first)[0]?.status, 'failed');
    store.event(first.id, 'job', { id: 'interrupted', command: 'long task', status: 'running', pid: 12345 });
    assert.equal(jobs.list(store, first).find(job => job.id === 'interrupted')?.status, 'unknown');
    jobs.resolve(store, first, 'interrupted', 'Checked process exit and output');
    assert.equal(jobs.list(store, first).find(job => job.id === 'interrupted')?.status, 'completed');
  } finally { await jobs.close(); store.close(); }
});
