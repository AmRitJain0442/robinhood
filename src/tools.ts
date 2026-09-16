import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { link, lstat, open, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MAX_FILE_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024;
const secretNames = /^(?:\.env(?:\..*)?|auth\.json|credentials\.json|id_rsa|id_ed25519)$/i;
const excludedDirs = new Set(['.git', '.robinhood', 'node_modules', '.gemini', '.copilot', 'cli-profiles']);

export const toolDefinitions = [
  { type: 'function', function: { name: 'list_files', description: 'List one workspace directory, at most 200 entries.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'read_file', description: 'Read a UTF-8 workspace file and its SHA-256 hash, at most 64 KiB.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'write_file', description: 'Create or replace a UTF-8 workspace file. Supply the SHA-256 from read_file for an existing file, or null only for a new file. Requires approval.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, expectedHash: { type: ['string', 'null'] } }, required: ['path', 'content', 'expectedHash'], additionalProperties: false } } },
  { type: 'function', function: { name: 'run_command', description: 'Run an approved shell command in the workspace with a 30-second time limit and bounded output. The command has the user\'s OS privileges.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false } } },
];

export const hash = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

export async function workspaceIdentity(workspace: string): Promise<string> {
  const location = await realpath(workspace);
  const info = await stat(location);
  let head = 'no-commit';
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: location, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Git is optional. */ }
  return JSON.stringify({ location, device: info.dev, inode: info.ino, head });
}

async function inside(workspace: string, name: string, creating = false): Promise<string> {
  if (!name || name.includes('\0')) throw new Error('A workspace path is required.');
  const root = await realpath(workspace);
  const target = path.resolve(root, name);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Path is outside the workspace.');
  if (process.platform === 'win32' && relative.split(path.sep).some(part => /[:<>"|?*]/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Windows device paths and alternate data streams are not supported.');
  if (relative.split(path.sep).some(part => excludedDirs.has(part.toLowerCase()) || secretNames.test(part) || /\.(pem|key)$/i.test(part))) throw new Error('This path is excluded from model tools.');
  let resolved: string;
  try { resolved = await realpath(target); } catch (error) {
    if (!creating || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    resolved = path.join(await realpath(path.dirname(target)), path.basename(target));
  }
  const resolvedRelative = path.relative(root, resolved);
  if (resolvedRelative === '..' || resolvedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedRelative)) throw new Error('Resolved path escapes the workspace.');
  if (resolvedRelative.split(path.sep).some(part => excludedDirs.has(part.toLowerCase()) || secretNames.test(part) || /\.(pem|key)$/i.test(part))) throw new Error('Resolved path is excluded from model tools.');
  return resolved;
}

async function readBounded(filename: string): Promise<string> {
  const handle = await open(filename, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Expected a regular file.');
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > MAX_FILE_BYTES) throw new Error('File exceeds the 64 KiB read limit.');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, total));
  } finally { await handle.close(); }
}

export class UnknownOutcome extends Error {}

async function runCommand(workspace: string, command: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^ROBINHOOD_/i.test(key)));
  const child = spawn(command, { cwd: workspace, env, shell: true, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let bytes = 0;
  let stopReason: string | undefined;
  let stopAt = 0;
  let killFailure: Error | undefined;
  let closed = false;
  let killTimer: NodeJS.Timeout | undefined;
  const stop = (reason: string) => {
    if (stopReason || closed) return;
    stopReason = reason;
    stopAt = Date.now();
    if (!child.pid) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', error => { killFailure = error; });
      killer.on('exit', code => { if (code && !closed) killFailure = new Error(`taskkill returned ${code}`); });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') killFailure = error as Error; }
      killTimer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* Process may have exited. */ } }, 1000);
    }
  };
  const collect = (chunk: Buffer) => {
    const remaining = MAX_OUTPUT_BYTES - bytes;
    if (remaining > 0) output += chunk.subarray(0, remaining).toString('utf8');
    bytes += chunk.length;
    if (bytes > MAX_OUTPUT_BYTES) stop('Output limit reached');
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const cancel = () => stop('Cancelled by user');
  signal.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => stop('30-second time limit reached'), 30_000);
  let watchdog: NodeJS.Timeout | undefined;
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => { closed = true; resolve(code); });
      watchdog = setInterval(() => {
        if (killFailure) reject(new UnknownOutcome(`Could not confirm command termination: ${killFailure.message}`));
        if (stopAt && Date.now() - stopAt > 5000) reject(new UnknownOutcome('Command termination was not confirmed within five seconds. Inspect the process before continuing.'));
      }, 100);
      // A hanging termination must not silently become a completed receipt.
      killTimer?.unref();
    });
    return JSON.stringify({ exitCode: code, stopped: stopReason ?? null, output });
  } finally {
    clearTimeout(timeout);
    clearTimeout(killTimer);
    clearInterval(watchdog);
    signal.removeEventListener('abort', cancel);
    if (!closed) { child.stdout.destroy(); child.stderr.destroy(); child.unref(); }
  }
}

export interface PreparedTool {
  description: string;
  execute(signal: AbortSignal): Promise<string>;
}

export async function prepareTool(workspace: string, name: string, raw: string): Promise<PreparedTool> {
  const args: unknown = JSON.parse(raw);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
  const input = args as Record<string, unknown>;
  if (name === 'run_command') {
    if (typeof input.command !== 'string' || !input.command.trim() || input.command.length > 4000 || input.command.includes('\0')) throw new Error('A command of 1-4000 characters is required.');
    const command = input.command;
    return { description: `Run in ${workspace}:\n${command}`, execute: signal => runCommand(workspace, command, signal) };
  }
  if (!['read_file', 'write_file', 'list_files'].includes(name)) throw new Error(`Unsupported tool: ${name}`);
  if (typeof input.path !== 'string') throw new Error('Tool path must be a string.');
  const filename = input.path;
  await inside(workspace, filename, name === 'write_file');
  if (name === 'list_files') return {
    description: `List directory: ${filename}`,
    execute: async signal => {
      signal.throwIfAborted();
      const entries = await readdir(await inside(workspace, filename), { withFileTypes: true });
      return JSON.stringify(entries.filter(entry => !excludedDirs.has(entry.name.toLowerCase()) && !secretNames.test(entry.name)).slice(0, 200).map(entry => ({ name: entry.name, directory: entry.isDirectory() })));
    },
  };
  if (name === 'read_file') return {
    description: `Read file: ${filename}`,
    execute: async signal => {
      signal.throwIfAborted();
      const content = await readBounded(await inside(workspace, filename));
      return JSON.stringify({ path: filename, sha256: hash(content), content });
    },
  };
  if (typeof input.content !== 'string' || Buffer.byteLength(input.content) > MAX_FILE_BYTES) throw new Error('New file content must be UTF-8 text at most 64 KiB.');
  if (input.expectedHash !== null && (typeof input.expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedHash))) throw new Error('Supply expectedHash from read_file, or null for a new file.');
  const content = input.content;
  const expectedHash = input.expectedHash;
  return {
    description: `Write ${filename} (${Buffer.byteLength(content)} bytes)\n${content}`,
    execute: async signal => {
      signal.throwIfAborted();
      const target = await inside(workspace, filename, true);
      const check = async () => {
        if (expectedHash === null) {
          if (await lstat(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('File already exists; read it before replacing it.');
        } else if (hash(await readBounded(target)) !== expectedHash) throw new Error('File changed since it was read. Read it again before writing.');
      };
      await check();
      const temp = path.join(path.dirname(target), `.robinhood-write-${randomUUID()}.tmp`);
      const mode = expectedHash === null ? 0o600 : (await stat(target)).mode;
      try {
        await writeFile(temp, content, { flag: 'wx', mode });
        signal.throwIfAborted();
        if (await inside(workspace, filename, true) !== target) throw new Error('Target changed while awaiting the write.');
        await check();
        if (expectedHash === null) await link(temp, target); // Exclusive creation; never overwrite a new external file.
        else await rename(temp, target);
        return JSON.stringify({ path: filename, sha256: hash(content), bytes: Buffer.byteLength(content) });
      } finally { await unlink(temp).catch(() => {}); }
    },
  };
}
