import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import { Store } from '../src/storage.js';
import { ownerIsAlive, ownerToken } from '../src/process-owner.js';

test('process identity distinguishes a reused PID while preserving a live lock', () => {
  const token = ownerToken('fixture');
  assert.ok(token.includes('|'), 'The current process creation identity must be available');
  assert.equal(ownerIsAlive({ pid: process.pid, token }), true);
  assert.equal(ownerIsAlive({ pid: process.pid, token: 'old|different-process-start' }), false);
  assert.equal(ownerIsAlive({ pid: process.pid, token: 'legacy-uuid' }), true);
});

test('recycled owner recovery preserves saved sessions and still rejects a second writer', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'robinhood-owner-'));
  const filename = path.join(directory, 'sessions.db');
  const first = new Store(filename);
  const session = first.create(directory, 'fixture', 'Keep this session');
  first.append(session.id, { role: 'user', content: 'Saved memory' });
  first.close();
  const db = new Database(filename);
  db.prepare('INSERT INTO owner VALUES (1, ?, ?)').run('old|different-process-start', process.pid);
  db.close();
  const recovered = new Store(filename);
  try {
    assert.equal(recovered.get(session.id).objective, 'Keep this session');
    assert.equal(recovered.messages(session.id)[0]?.content, 'Saved memory');
    recovered.claim(session.id);
    const second = new Store(filename);
    try { assert.throws(() => second.claim(session.id), /already open/); } finally { second.close(); }
  } finally { recovered.close(); }
});

test('legacy Windows ownership does not mistake an unrelated executable for Robinhood', { skip: process.platform !== 'win32' }, async () => {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Write-Output ready; Start-Sleep -Seconds 30'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    await once(child.stdout!, 'data');
    assert.equal(ownerIsAlive({ pid: child.pid!, token: 'legacy-uuid' }), false);
    assert.equal(child.exitCode, null, 'Inspecting ownership does not stop the unrelated process');
  } finally { child.kill(); await once(child, 'close'); }
});
