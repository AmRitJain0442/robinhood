import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { benchmarkPatch } from '../src/benchmark-patch.js';

test('benchmark patches include new files and deletions without changing the real index', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rh-bench-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  await writeFile(path.join(root, 'before.txt'), 'old\n');
  git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  const index = await readFile(path.join(root, '.git', 'index'));
  await unlink(path.join(root, 'before.txt'));
  await writeFile(path.join(root, 'new.txt'), 'new\n');
  const diff = await benchmarkPatch(root, base, path.join(root, '.git', 'export-index'));
  assert.match(diff, /deleted file mode/); assert.match(diff, /new file mode/); assert.match(diff, /\+new/);
  assert.deepEqual(await readFile(path.join(root, '.git', 'index')), index);
  await assert.rejects(benchmarkPatch(root, '--bad', path.join(root, '.git', 'export-index')), /pinned/);
});
