// Invoked only by the isolated SWE-bench controller, never by setup.
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { Store } from './storage.js';
import { Runner } from './session.js';
import { RoutePool } from './routing.js';
import { providers } from './providers/registry.js';
import { Secrets } from './privacy.js';
import { Capabilities } from './capabilities.js';
import { Jobs } from './jobs.js';
import { Terminals } from './terminals.js';
import { workspaceIdentity } from './tools.js';
import type { Connector } from './types.js';
import { benchmarkPatch } from './benchmark-patch.js';

async function main() {
  if (process.env.ROBINHOOD_BENCHMARK !== 'swebench-lite') throw new Error('This worker must run in the benchmark container.');
  const task = JSON.parse(await readFile('/rh-task.json', 'utf8')) as { instance_id: string; base_commit: string; problem_statement: string; timeout_seconds: number; providers: string[] };
  if (!/^[\w.-]+$/.test(task.instance_id) || !/^[a-f0-9]{40}$/.test(task.base_commit) || typeof task.problem_statement !== 'string' || !Number.isInteger(task.timeout_seconds) || task.timeout_seconds < 1 || task.timeout_seconds > 7200 || !Array.isArray(task.providers) || !task.providers.length || task.providers.some(id => !['kilo', 'opencode', 'kilo-cli', 'openrouter'].includes(id))) throw new Error('Invalid benchmark task.');
  const workspace = await realpath('/testbed');
  const git = (...args: string[]) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 30_000 });
  if (git('rev-parse', 'HEAD').trim() !== task.base_commit) throw new Error('Benchmark checkout does not match the pinned base commit.');
  if (git('status', '--porcelain').trim()) throw new Error('Benchmark checkout is not clean.');
  await mkdir('/rh-output', { recursive: true });
  const store = new Store('/rh-output/session.db');
  const secrets = new Secrets();
  const capabilities = new Capabilities(new Jobs(secrets), new Terminals(secrets));
  // No browser or human clarification in the unattended evaluation protocol.
  capabilities.definitions = capabilities.definitions.filter(tool => !['web_fetch', 'ask_user'].includes(tool.function.name));
  const session = store.create(workspace, await workspaceIdentity(workspace), `SWE-bench Lite ${task.instance_id}`);
  const connections = new Map<string, Connector>();
  const started = Date.now();
  let state = 'error', error: string | undefined;
  const signal = AbortSignal.timeout(task.timeout_seconds * 1000);
  const log = (text: string) => console.log(secrets.redact(text));
  try {
    for (const id of task.providers) {
      const definition = providers.find(entry => entry.id === id)!;
      const key = process.env[definition.env] ?? '';
      if (id === 'openrouter' && !key) throw new Error('OPENROUTER_API_KEY is required for this profile.');
      secrets.add(key);
      connections.set(id, definition.create(key));
    }
    const routes = await new RoutePool().discover(connections, undefined, null, signal, log);
    store.event(session.id, 'benchmark-routes', routes.map(route => route.id));
    const prompt = `Fix the following issue in the checked-out repository. Inspect the code, implement the fix and run relevant local tests. Leave changes uncommitted. Do not retrieve published solutions, issue discussions, reference patches or other benchmark tasks. Work only from the issue and this checkout. Do not change Git history or access /rh-output. There is no human available for clarification.\n\n${task.problem_statement}`;
    await new Runner(store, secrets, capabilities).turn(session, prompt, routes, {
      approvalMode: 'yolo', text: log, status: log,
      approve: async () => true, approveRequest: async () => true,
    }, signal);
    const last = store.messages(session.id).at(-1);
    state = last?.role === 'assistant' && !last.tool_calls?.length ? 'final-response' : 'step-limit';
  } catch (caught) { error = secrets.redact(String(caught)); state = signal.aborted ? 'timeout' : 'error'; }
  finally {
    await capabilities.close().catch(caught => { error = secrets.redact(String(caught)); state = 'cleanup-error'; });
    await Promise.allSettled([...connections.values()].map(connection => connection.close?.()));
    try { await writeFile('/rh-output/patch.diff', await benchmarkPatch(workspace, task.base_commit, '/rh-output/export.index')); }
    catch (caught) { error = secrets.redact(String(caught)); state = 'patch-error'; }
    const events = store.events(session.id);
    await writeFile('/rh-output/trace.json', secrets.redact(JSON.stringify({ messages: store.messages(session.id), events, operations: store.operations(session.id) }, null, 2)));
    await writeFile('/rh-output/result.json', JSON.stringify({ instance_id: task.instance_id, state, error, elapsed_seconds: (Date.now() - started) / 1000, session: session.id }, null, 2));
    store.close();
  }
}

main().catch(error => { console.error(String(error)); process.exitCode = 1; });
