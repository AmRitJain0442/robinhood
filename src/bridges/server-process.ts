import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { boundedJSON } from '../providers/chat-completions.js';

export interface Engine {
  request(route: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}
export interface ServerRuntime {
  packageName: string; version: string; bin: string; envPrefix: string; directoryHeader: string;
  nodeLauncher?: boolean;
  extraEnv?: Record<string, string>;
}

// An owned, isolated CLI engine CLI process, using the server API behind its terminal.
// No shell quoting, project plugins, personal auth.json, or account environment is inherited.
export class ServerProcess implements Engine {
  private child?: ChildProcess;
  private startPromise?: Promise<void>;
  private baseURL = '';
  private authorization = '';
  private directory = '';
  private scratch = '';
  private closing?: Promise<void>;
  private stopped = false;
  constructor(private readonly config: unknown, private readonly runtime: ServerRuntime) {}
  private async start(): Promise<void> {
    if (this.stopped) throw new Error('CLI engine bridge was closed. Reconnect it.');
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.launch();
    return this.startPromise;
  }
  private async launch() {
    const require = createRequire(import.meta.url);
    let packageFile: string;
    try { packageFile = require.resolve(`${this.runtime.packageName}/package.json`); }
    catch { throw new Error(`CLI engine runtime is missing. In the Robinhood checkout run: npm install --include=optional`); }
    const pkg = JSON.parse(await readFile(packageFile, 'utf8')) as { version: string; bin: Record<string, string> };
    if (pkg.version !== this.runtime.version) throw new Error(`This bridge requires CLI engine ${this.runtime.version}. Run npm ci in the Robinhood checkout.`);
    const scratch = await mkdtemp(path.join(tmpdir(), 'robinhood-opencode-'));
    this.scratch = scratch;
    this.directory = path.join(scratch, 'workspace'); await mkdir(this.directory);
    if (this.stopped) { await this.removeScratch(); throw new Error('CLI engine startup was cancelled.'); }
    const password = randomUUID();
    this.authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
    const env: NodeJS.ProcessEnv = {};
    for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'PATHEXT']) if (process.env[name]) env[name] = process.env[name];
    Object.assign(env, {
      HOME: scratch, USERPROFILE: scratch,
      XDG_CONFIG_HOME: path.join(scratch, 'config'), XDG_DATA_HOME: path.join(scratch, 'data'),
      XDG_CACHE_HOME: path.join(scratch, 'cache'), XDG_STATE_HOME: path.join(scratch, 'state'),
      [`${this.runtime.envPrefix}_CONFIG_CONTENT`]: JSON.stringify(this.config), [`${this.runtime.envPrefix}_SERVER_PASSWORD`]: password,
      [`${this.runtime.envPrefix}_SERVER_USERNAME`]: 'opencode',
      [`${this.runtime.envPrefix}_DISABLE_PROJECT_CONFIG`]: 'true', [`${this.runtime.envPrefix}_DISABLE_AUTOUPDATE`]: 'true',
      [`${this.runtime.envPrefix}_DISABLE_DEFAULT_PLUGINS`]: 'true',
      ...this.runtime.extraEnv,
    });
    const binary = path.resolve(path.dirname(packageFile), pkg.bin[this.runtime.bin]!);
    this.child = spawn(this.runtime.nodeLauncher ? process.execPath : binary, [...(this.runtime.nodeLauncher ? [binary] : []), 'serve', '--hostname=127.0.0.1', '--port=0'], { cwd: this.directory, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const child = this.child;
    try {
      await new Promise<void>((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => finish(new Error('CLI engine startup timed out. Reconnect to try again.')), 30_000);
        const onError = () => finish(new Error('CLI engine could not start. Reinstall its optional runtime.'));
        const onExit = () => finish(new Error('CLI engine exited before its server was ready.'));
        const onData = (chunk: Buffer) => {
          output = (output + chunk.toString()).slice(-8192);
          const match = output.match(/(?:opencode|kilo) server listening on (http:\/\/127\.0\.0\.1:\d+)/);
          if (match) { this.baseURL = match[1]!; finish(); }
        };
        const finish = (error?: Error) => {
          clearTimeout(timer); child.off('error', onError); child.off('exit', onExit);
          child.stdout?.off('data', onData); child.stderr?.off('data', onData);
          error ? reject(error) : resolve();
        };
        child.on('error', onError); child.on('exit', onExit); child.stdout?.on('data', onData); child.stderr?.on('data', onData);
      });
      // Drain logs without exposing engine diagnostics or model content to another channel.
      child.stdout?.resume(); child.stderr?.resume(); child.on('error', () => {});
    } catch (error) { await this.close(); throw error; }
  }
  async request(route: string, method = 'GET', body?: unknown, signal = AbortSignal.timeout(15_000)): Promise<unknown> {
    signal.throwIfAborted();
    const abort = () => { void this.close().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      await this.start(); signal.throwIfAborted();
      if (this.stopped || !this.child || this.child.exitCode !== null || this.child.signalCode !== null) throw new Error('CLI engine stopped. Use /connect with the engine ID to restart it.');
      return await boundedJSON(await fetch(`${this.baseURL}${route}`, {
        method, headers: { authorization: this.authorization, 'content-type': 'application/json', [this.runtime.directoryHeader]: encodeURIComponent(this.directory) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal, redirect: 'error',
      }));
    } finally { signal.removeEventListener('abort', abort); }
  }
  close(): Promise<void> {
    this.stopped = true;
    return this.closing ??= this.stop();
  }
  private async removeScratch(): Promise<void> {
    if (!this.scratch) return;
    const target = path.resolve(this.scratch);
    // Verify the final absolute path is our direct temporary child before recursive removal.
    if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith('robinhood-opencode-')) throw new Error('Refusing to clean an unexpected CLI engine directory.');
    await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  private async stop(): Promise<void> {
    const child = this.child;
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'close').catch(() => {});
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        await once(killer, 'close');
      } else { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
      await Promise.race([exited, new Promise<void>(resolve => { setTimeout(resolve, 5000).unref(); })]);
      if (child.exitCode === null && child.signalCode === null) throw new Error('CLI engine did not exit; its temporary data was retained.');
    }
    await this.removeScratch();
  }
}

