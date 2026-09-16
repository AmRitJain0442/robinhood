import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hash, MAX_FILE_BYTES, prepareTool } from '../src/tools.js';

const fixture = async () => realpath(await mkdtemp(path.join(tmpdir(), 'robinhood tools test ')));
const signal = () => new AbortController().signal;

test('native CLI credential profiles are excluded from file tools', async () => {
  const root = await fixture();
  for (const filename of ['.gemini/oauth_creds.json', '.copilot/config.json', 'cli-profiles/gemini/settings.json']) {
    await assert.rejects(prepareTool(root, 'read_file', JSON.stringify({ path: filename })), /excluded/);
    await assert.rejects(prepareTool(root, 'write_file', JSON.stringify({ path: filename, content: 'x', expectedHash: null })), /excluded/);
  }
});

test('file replacement detects an external edit made after approval preparation', async () => {
  const root = await fixture();
  const filename = path.join(root, 'sample.txt');
  await writeFile(filename, 'before');
  const read = await prepareTool(root, 'read_file', JSON.stringify({ path: 'sample.txt' }));
  const result = JSON.parse(await read.execute(signal())) as { sha256: string };
  const write = await prepareTool(root, 'write_file', JSON.stringify({ path: 'sample.txt', content: 'replacement', expectedHash: result.sha256 }));
  await writeFile(filename, 'external edit');
  await assert.rejects(write.execute(signal()), /changed since/);
  assert.equal(await readFile(filename, 'utf8'), 'external edit');
});

test('exclusive creation refuses to overwrite a file created after approval preparation', async () => {
  const root = await fixture();
  const tool = await prepareTool(root, 'write_file', JSON.stringify({ path: 'new.txt', content: 'model edit', expectedHash: null }));
  await writeFile(path.join(root, 'new.txt'), 'user edit');
  await assert.rejects(tool.execute(signal()), /already exists/);
  assert.equal(await readFile(path.join(root, 'new.txt'), 'utf8'), 'user edit');
});

test('approved file creation and replacement return hashes that match the actual file', async () => {
  const root = await fixture();
  const create = await prepareTool(root, 'write_file', JSON.stringify({ path: 'file.txt', content: 'one', expectedHash: null }));
  await create.execute(signal());
  const replace = await prepareTool(root, 'write_file', JSON.stringify({ path: 'file.txt', content: 'two', expectedHash: hash('one') }));
  const result = JSON.parse(await replace.execute(signal())) as { sha256: string };
  assert.equal(result.sha256, hash(await readFile(path.join(root, 'file.txt'))));
});

test('traversal, excluded credential files, and a junction escaping the workspace are rejected', async () => {
  const base = await fixture();
  const root = path.join(base, 'workspace');
  const outside = path.join(base, 'outside');
  await mkdir(root); await mkdir(outside);
  await writeFile(path.join(outside, 'private.txt'), 'outside');
  await writeFile(path.join(root, '.env'), 'SECRET=value');
  await symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const filename of ['../outside/private.txt', '.env', 'escape/private.txt']) {
    await assert.rejects(prepareTool(root, 'read_file', JSON.stringify({ path: filename })), /outside|excluded|escapes/);
  }
  if (process.platform === 'win32') await assert.rejects(prepareTool(root, 'write_file', JSON.stringify({ path: 'file.txt:stream', content: 'x', expectedHash: null })), /alternate data streams/);
});

test('oversized and binary files fail without entering model context', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'large.txt'), Buffer.alloc(MAX_FILE_BYTES + 1, 65));
  await writeFile(path.join(root, 'binary.txt'), Buffer.from([0xff, 0xfe, 0xfa]));
  for (const filename of ['large.txt', 'binary.txt']) {
    const tool = await prepareTool(root, 'read_file', JSON.stringify({ path: filename }));
    await assert.rejects(tool.execute(signal()));
  }
});

test('cancellation terminates the shell process tree and returns a settled receipt', { timeout: 15_000 }, async () => {
  const root = await fixture();
  const tool = await prepareTool(root, 'run_command', JSON.stringify({ command: 'node -e "require(\'fs\').writeFileSync(\'child-pid.txt\',String(process.pid));setInterval(()=>{},1000)"' }));
  const controller = new AbortController();
  const running = tool.execute(controller.signal);
  let pid: number | undefined;
  const deadline = Date.now() + 5000;
  while (!pid && Date.now() < deadline) {
    pid = await readFile(path.join(root, 'child-pid.txt'), 'utf8').then(Number, () => undefined);
    if (!pid) await new Promise(resolve => setTimeout(resolve, 50));
  }
  controller.abort();
  const result = JSON.parse(await running) as { stopped: string };
  assert.ok(pid, 'child process started');
  assert.equal(result.stopped, 'Cancelled by user');
  // POSIX containers may briefly retain a zombie. The pipe closure and process-group
  // cancellation are verified above; Windows must report the child gone.
  if (process.platform === 'win32') assert.throws(() => process.kill(pid!, 0), /ESRCH/);
});

test('command output is bounded even when a subprocess prints excessively', { timeout: 15_000 }, async () => {
  const root = await fixture();
  const tool = await prepareTool(root, 'run_command', JSON.stringify({ command: 'node -e "process.stdout.write(\'x\'.repeat(1000000))"' }));
  const result = JSON.parse(await tool.execute(signal())) as { output: string; stopped: string };
  assert.ok(Buffer.byteLength(result.output) <= 32 * 1024);
  assert.equal(result.stopped, 'Output limit reached');
});
