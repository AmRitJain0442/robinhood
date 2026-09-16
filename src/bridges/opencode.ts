import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { RouteError, type Connector, type ModelInfo, type Route, type Completion } from '../types.js';
import { boundedJSON, object } from '../providers/chat-completions.js';
import { contextBudget, manualConsent } from '../providers/http.js';
import { chatMessages } from '../providers/memory.js';
import { toolDefinitions } from '../tools.js';

export const OPENCODE_VERSION = '1.18.31';
export const freeModelIDs = ['big-pickle', 'mimo-v2.5-free', 'ling-3.0-flash-fin-free', 'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free', 'muse-spark-1.3-contributor-free'];
export interface Engine {
  request(route: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

export function engineConfig() {
  return {
    autoupdate: false, share: 'disabled', snapshot: false,
    enabled_providers: ['opencode'], model: 'opencode/big-pickle', small_model: 'opencode/big-pickle',
    provider: { opencode: { whitelist: freeModelIDs } },
    permission: { '*': 'deny', StructuredOutput: 'allow' }, compaction: { auto: false, prune: false },
    agent: {
      robinhood: { mode: 'primary', permission: { '*': 'deny', StructuredOutput: 'allow' }, steps: 2, prompt: 'You provide structured suggestions to Robinhood. Only Robinhood executes tools. Always call StructuredOutput to return your suggestions; this only returns data and does not execute workspace actions.' },
      title: { disable: true }, summary: { disable: true }, compaction: { disable: true },
    },
  };
}

// An owned, isolated OpenCode CLI process, using the server API behind its terminal.
// No shell quoting, project plugins, personal auth.json, or account environment is inherited.
export class OpenCodeProcess implements Engine {
  private child?: ChildProcess;
  private startPromise?: Promise<void>;
  private baseURL = '';
  private authorization = '';
  private directory = '';
  private scratch = '';
  private closing?: Promise<void>;
  private stopped = false;
  constructor(private readonly config: unknown = engineConfig()) {}
  private async start(): Promise<void> {
    if (this.stopped) throw new Error('OpenCode bridge was closed. Reconnect it.');
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.launch();
    return this.startPromise;
  }
  private async launch() {
    const require = createRequire(import.meta.url);
    let packageFile: string;
    try { packageFile = require.resolve('opencode-ai/package.json'); }
    catch { throw new Error(`OpenCode runtime is missing. In the Robinhood checkout run: npm install --include=optional`); }
    const pkg = JSON.parse(await readFile(packageFile, 'utf8')) as { version: string; bin: { opencode: string } };
    if (pkg.version !== OPENCODE_VERSION) throw new Error(`This bridge requires OpenCode ${OPENCODE_VERSION}. Run npm ci in the Robinhood checkout.`);
    const scratch = await mkdtemp(path.join(tmpdir(), 'robinhood-opencode-'));
    this.scratch = scratch;
    this.directory = path.join(scratch, 'workspace'); await mkdir(this.directory);
    if (this.stopped) { await this.removeScratch(); throw new Error('OpenCode startup was cancelled.'); }
    const password = randomUUID();
    this.authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
    const env: NodeJS.ProcessEnv = {};
    for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'PATHEXT']) if (process.env[name]) env[name] = process.env[name];
    Object.assign(env, {
      HOME: scratch, USERPROFILE: scratch,
      XDG_CONFIG_HOME: path.join(scratch, 'config'), XDG_DATA_HOME: path.join(scratch, 'data'),
      XDG_CACHE_HOME: path.join(scratch, 'cache'), XDG_STATE_HOME: path.join(scratch, 'state'),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(this.config), OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true',
      OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
    });
    const binary = path.resolve(path.dirname(packageFile), pkg.bin.opencode);
    this.child = spawn(binary, ['serve', '--hostname=127.0.0.1', '--port=0'], { cwd: this.directory, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const child = this.child;
    try {
      await new Promise<void>((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => finish(new Error('OpenCode startup timed out. Reconnect to try again.')), 30_000);
        const onError = () => finish(new Error('OpenCode could not start. Reinstall its optional runtime.'));
        const onExit = () => finish(new Error('OpenCode exited before its server was ready.'));
        const onData = (chunk: Buffer) => {
          output = (output + chunk.toString()).slice(-8192);
          const match = output.match(/opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/);
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
      if (this.stopped || !this.child || this.child.exitCode !== null || this.child.signalCode !== null) throw new Error('OpenCode stopped. Use /connect opencode to restart it.');
      return await boundedJSON(await fetch(`${this.baseURL}${route}`, {
        method, headers: { authorization: this.authorization, 'content-type': 'application/json', 'x-opencode-directory': encodeURIComponent(this.directory) },
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
    if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith('robinhood-opencode-')) throw new Error('Refusing to clean an unexpected OpenCode directory.');
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
      if (child.exitCode === null && child.signalCode === null) throw new Error('OpenCode did not exit; its temporary data was retained.');
    }
    await this.removeScratch();
  }
}

export function freeEngineModels(data: unknown): ModelInfo[] {
  const all = object(data).all;
  if (!Array.isArray(all)) throw new RouteError('OpenCode returned an invalid provider catalog.', 'protocol');
  const models = object(all.find(item => object(item).id === 'opencode')).models;
  return Object.values(object(models)).flatMap(value => {
    const model = object(value), cost = object(model.cost), cache = object(cost.cache), limit = object(model.limit);
    if (typeof model.id !== 'string' || !freeModelIDs.includes(model.id) || model.status === 'deprecated' || object(model.capabilities).toolcall !== true) return [];
    if ([cost.input, cost.output, cache.read, cache.write].some(price => price !== 0) || cost.tiers !== undefined || cost.experimentalOver200K !== undefined) return [];
    if (typeof limit.context !== 'number' || !Number.isFinite(limit.context) || limit.context < 4096) return [];
    return [{ id: model.id, context: Math.min(limit.context, 64000) }];
  });
}

export const outputSchema = {
  type: 'object', additionalProperties: false, required: ['content', 'tool_calls'],
  properties: {
    content: { type: 'string' },
    tool_calls: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['name', 'arguments'], properties: {
      name: { type: 'string', enum: toolDefinitions.map(tool => tool.function.name) }, arguments: { type: 'string', description: 'A JSON-encoded object matching the requested Robinhood tool parameters.' },
    } } },
  },
};

export function engineCompletion(data: unknown): Completion {
  const info = object(object(data).info);
  if (info.error) {
    const error = object(info.error), status = object(error.data).statusCode;
    if (error.name === 'StructuredOutputError') throw new RouteError('This OpenCode model did not return the required structured response. No Robinhood tools were executed. Try another model.', 'protocol');
    if (status === 429) throw new RouteError('OpenCode free model is rate-limited. Wait or select another model; remaining allowance is unknown.', 'quota');
    if (status === 401 || status === 403) throw new RouteError('OpenCode rejected anonymous access to this model. Select another advertised free model.', 'auth');
    throw new RouteError('OpenCode could not complete the request. Reconnect or choose another model.', 'protocol');
  }
  const result = object(info.structured);
  if (typeof result.content !== 'string' || !Array.isArray(result.tool_calls) || result.tool_calls.length > 8) throw new RouteError('OpenCode did not return a valid structured response. No tools were executed.', 'protocol');
  const calls = result.tool_calls.map(item => {
    const call = object(item);
    if (!toolDefinitions.some(tool => tool.function.name === call.name) || typeof call.arguments !== 'string') throw new RouteError('OpenCode returned an unsupported tool.', 'protocol');
    let args: unknown; try { args = JSON.parse(call.arguments); } catch { throw new RouteError('OpenCode returned invalid tool arguments.', 'protocol'); }
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new RouteError('Expected a tool argument object.', 'protocol');
    return { id: randomUUID(), type: 'function' as const, function: { name: call.name as string, arguments: call.arguments } };
  });
  const tokens = object(info.tokens);
  const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
  return { message: { role: 'assistant', content: result.content, ...(calls.length ? { tool_calls: calls } : {}) }, usage: { inputTokens: count(tokens.input), outputTokens: count(tokens.output) } };
}

export class OpenCodeBridge implements Connector {
  private engine?: Engine;
  constructor(private readonly factory: () => Engine = () => new OpenCodeProcess()) {}
  private runtime() { return this.engine ??= this.factory(); }
  async close() { const engine = this.engine; this.engine = undefined; await engine?.close(); }
  async models(signal = AbortSignal.timeout(45_000)): Promise<ModelInfo[]> {
    try { return freeEngineModels(await this.runtime().request('/provider', 'GET', undefined, AbortSignal.any([signal, AbortSignal.timeout(45_000)]))); }
    catch (error) { await this.close(); throw error; }
  }
  route(model: string): Route {
    return { id: `opencode/${model}`, provider: 'opencode', model,
      manualApproval: 'OpenCode CLI free-model bridge. Promotional models may retain data for training; use public, non-confidential data only. Allowance is unknown. OpenCode can retry internally within a two-minute deadline. No paid account credentials are loaded.',
      complete: async (messages, signal, onText, consent) => {
        manualConsent(consent);
        const bounded = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
        const selected = (await this.models(bounded)).find(item => item.id === model);
        if (!selected) throw new RouteError('This model is no longer advertised as free and tool-capable by OpenCode.', 'policy');
        const history = chatMessages(messages, 'opencode', model);
        const prompt = `Return structured suggestions for Robinhood. Do not execute anything yourself. To inspect or change the real workspace, request the following Robinhood tools using tool_calls. Their results arrive in subsequent history. Use content for your user-facing answer; return an empty tool_calls array when finished. Historical tool receipts describe actions already performed; never replay them.\nTools: ${JSON.stringify(toolDefinitions)}\nConversation history: ${JSON.stringify(history)}`;
        contextBudget({ prompt }, selected.context);
        const engine = this.runtime();
        let id: string | undefined;
        try {
          const session = object(await engine.request('/session', 'POST', { title: 'Robinhood model request', permission: [{ permission: '*', pattern: '*', action: 'deny' }, { permission: 'StructuredOutput', pattern: '*', action: 'allow' }] }, bounded));
          if (typeof session.id !== 'string' || !/^[\w-]+$/.test(session.id)) throw new Error('Invalid OpenCode session.');
          id = session.id;
          const result = engineCompletion(await engine.request(`/session/${id}/message`, 'POST', {
            model: { providerID: 'opencode', modelID: model }, agent: 'robinhood',
            format: { type: 'json_schema', schema: outputSchema, retryCount: 0 }, parts: [{ type: 'text', text: prompt }],
          }, bounded));
          if (result.message.content) onText(result.message.content);
          return result;
        } catch (error) { await this.close(); throw error; }
        finally {
          if (id && this.engine === engine) {
            try { await engine.request(`/session/${id}`, 'DELETE', undefined, AbortSignal.timeout(5000)); }
            catch { await this.close(); }
          }
        }
      },
    };
  }
}
