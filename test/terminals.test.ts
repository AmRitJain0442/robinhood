import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/storage.js';
import { Terminals } from '../src/terminals.js';

let available = true;
try { await import('node-pty'); } catch { available = false; }
test('real persistent terminal retains shell variables and isolates session ownership', { skip: !available, timeout: 20000 }, async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'robinhood-pty-')));
  const store = new Store(path.join(root, 'state.db')); const terminals = new Terminals();
  try {
    const session = store.create(root, 'fixture', 'PTY test');
    const terminal = await terminals.open(store, session);
    assert.throws(() => terminals.send('another-session', terminal.id, 'echo no\r'), /does not own/);
    terminals.send(session.id, terminal.id, process.platform === 'win32' ? "$rh_fixture='persisted'\r" : "rh_fixture='persisted'\r");
    terminals.send(session.id, terminal.id, process.platform === 'win32' ? "Write-Output ('RH_'+$rh_fixture)\r" : 'echo "RH_${rh_fixture}"\r');
    const deadline = Date.now() + 10000;
    while (!terminals.read(session.id, terminal.id).includes('RH_persisted') && Date.now() < deadline) await delay(100);
    assert.match(terminals.read(session.id, terminal.id), /RH_persisted/);
    assert.throws(() => store.fork(session.id), /background/);
    await terminals.stop(session.id, terminal.id);
    assert.equal(terminals.list(store, session)[0]?.status, 'closed');
  } finally { await terminals.close(); store.close(); }
});
