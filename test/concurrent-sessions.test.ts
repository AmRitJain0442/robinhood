import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { Store } from '../src/storage.js';
import { ownerToken } from '../src/process-owner.js';
import { usageSummary } from '../src/usage.js';

test('concurrent stores share history and usage but protect each active task', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'robinhood-concurrent-'));
  const filename = path.join(root, 'sessions.db');
  const a = new Store(filename);
  const b = new Store(filename);
  try {
    const first = a.create(root, 'fixture', 'First task');
    const second = b.create(root, 'fixture', 'Same repository, separate task');
    const third = b.create(path.join(root, 'another-repo'), 'fixture', 'Another repository');
    a.event(first.id, 'usage', { provider: 'fixture', model: 'one', inputTokens: 11, outputTokens: 2 });
    b.event(third.id, 'usage', { provider: 'fixture', model: 'two', inputTokens: 7, outputTokens: 3 });
    assert.equal(b.list().length, 3);
    assert.equal(usageSummary(a).total.input, 18);
    assert.equal(usageSummary(b, root).total.input, 11);
    for (const mutate of [() => b.claim(first.id), () => b.append(first.id, { role: 'user', content: 'collision' }), () => b.delete(first.id), () => b.selectRoute(first.id, 'wrong'), () => b.fork(first.id)]) assert.throws(mutate, /already open/);
    assert.equal(a.get(first.id).route, null);
    assert.equal(a.messages(first.id).length, 0);
    a.close();
    b.claim(first.id);
    b.append(first.id, { role: 'user', content: 'Resumed after owner exited' });
    assert.equal(b.messages(first.id).length, 1);
    assert.equal(b.get(second.id).objective, 'Same repository, separate task');
  } finally { a.close(); b.close(); }
});

test('another process can work concurrently; crash recovery touches only abandoned tasks', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'robinhood-processes-'));
  const filename = path.join(root, 'sessions.db');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./session-owner-worker.js', import.meta.url)), filename, root], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let errors = '';
  child.stderr!.on('data', data => { errors += data; });
  let a: Store | undefined;
  let recovered: Store | undefined;
  try {
    const ready = await Promise.race([once(child, 'message').then(([value]) => value as { session: string; operation: string }), once(child, 'exit').then(() => { throw new Error(errors || 'Child exited before ready'); })]);
    a = new Store(filename);
    assert.equal(a.operations(ready.session)[0]!.state, 'running');
    assert.throws(() => a!.claim(ready.session), /already open/);
    assert.throws(() => a!.finish(ready.operation, 'completed', 'wrong owner'), /already open/);
    const session = a.create(path.join(root, 'repo-two'), 'fixture', 'Parent task');
    const [op] = a.prepare(session.id, { role: 'assistant', content: null, tool_calls: [{ id: 'parent-call', type: 'function', function: { name: 'run_command', arguments: '{}' } }] });
    a.running(op!.id);
    const exited = once(child, 'exit');
    child.send('crash');
    await exited;
    recovered = new Store(filename);
    assert.equal(recovered.operations(ready.session)[0]!.state, 'unknown');
    assert.equal(recovered.operations(session.id)[0]!.state, 'running');
    recovered.claim(ready.session);
    assert.throws(() => recovered!.claim(session.id), /already open/);
    a.finish(op!.id, 'completed', 'Parent continued without interruption');
  } finally {
    recovered?.close(); a?.close();
    if (child.exitCode === null) { const closed = once(child, 'close'); child.kill(); await closed; }
  }
});

test('migration refuses a live legacy process and preserves its version', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'robinhood-migration-'));
  const filename = path.join(root, 'sessions.db');
  const db = new Database(filename);
  try {
    db.exec('CREATE TABLE owner (id INTEGER PRIMARY KEY, token TEXT NOT NULL, pid INTEGER NOT NULL); PRAGMA user_version=1;');
    db.prepare('INSERT INTO owner VALUES (1, ?, ?)').run(ownerToken('legacy'), process.pid);
    assert.throws(() => new Store(filename), /older Robinhood/);
    assert.equal(db.pragma('user_version', { simple: true }), 1);
    db.prepare('DELETE FROM owner').run();
    const migrated = new Store(filename);
    migrated.close();
    assert.equal(db.pragma('user_version', { simple: true }), 2);
  } finally { db.close(); }
});
