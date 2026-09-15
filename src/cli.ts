#!/usr/bin/env node
import { createInterface, type Interface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OpenRouter } from './providers/openrouter.js';
import { Runner, type Interaction } from './session.js';
import { Store } from './storage.js';
import { Secrets, terminalText } from './privacy.js';
import { workspaceIdentity } from './tools.js';
import { demo } from './demo.js';
import type { Route, Session } from './types.js';

const help = `Robinhood 0.0.1 / developer preview

  npm run build
  npm start -- --workspace <directory>
  npm run demo                        Offline handoff demonstration

Options: --workspace PATH, --data-dir PATH, --session ID, --help, --version

In the terminal:
  /connect [openrouter]    Enter an API key without echo; kept in this process only
  /models                 List currently verified free tool-capable models
  /use MODEL              Select a model after checking current free pricing
  /providers              Connection and selected route
  /new                    Start a new task with your next message
  /sessions               List saved sessions
  /resume ID              Resume a session in this workspace
  /continue               Continue the saved task without adding a new message
  /memory                 Inspect the task's saved conversation
  /pending                Inspect operations needing reconciliation
  /resolve ID NOTE        Record the outcome you verified for an uncertain operation
  /reconcile              Accept a changed checkout after inspecting the workspace
  /status                 Inspect locally observed requests and usage
  /export PATH            Export this session after confirmation; never overwrite a file
  /delete                 Delete this session after confirmation
  /disconnect             Drop this process's provider connection
  /quit                   Save and exit

Only OpenRouter is implemented for hosted inference in this preview.
Gemini, Groq, account-login agents, and automatic live-provider fallback are pending.
All tool calls require approval. Approved commands have your OS privileges.
Ctrl+C cancels an active turn; Ctrl+C at the prompt exits. No telemetry.`;

class Terminal {
  readonly rl: Interface;
  private muted = false;
  private closed = false;
  private readonly ended: Promise<never>;
  private end!: (reason: Error) => void;
  private streaming = false;
  constructor(private readonly secrets: Secrets) {
    const sink = new Writable({ write: (chunk, _encoding, done) => { if (!this.muted) process.stdout.write(chunk); done(); } });
    Object.assign(sink, { isTTY: true, columns: process.stdout.columns });
    this.rl = createInterface({ input: process.stdin, output: sink, terminal: true, historySize: 0 });
    this.ended = new Promise((_, reject) => { this.end = reject; });
    void this.ended.catch(() => {});
    this.rl.on('close', () => { this.closed = true; this.end(new Error('Terminal closed.')); });
  }
  line(text: string): void {
    if (this.streaming) { process.stdout.write('\n'); this.streaming = false; }
    process.stdout.write(`${terminalText(this.secrets.redact(text))}\n`);
  }
  text(text: string): void {
    if (!this.streaming) { process.stdout.write('\nAssistant  '); this.streaming = true; }
    process.stdout.write(terminalText(this.secrets.redact(text)));
  }
  async question(prompt: string, signal?: AbortSignal): Promise<string> {
    if (this.closed) throw new Error('Terminal closed.');
    if (this.streaming) { process.stdout.write('\n'); this.streaming = false; }
    return Promise.race([this.rl.question(prompt, { signal }), this.ended]);
  }
  async password(): Promise<string> {
    this.line('API key stays in this process; it is never written to the session database.');
    process.stdout.write('OpenRouter API key (hidden): ');
    this.muted = true;
    try { return (await this.question('')).trim(); }
    finally { this.muted = false; process.stdout.write('\n'); }
  }
  close(): void { this.rl.close(); }
}

function dataPath(): string {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local'), 'Robinhood');
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support', 'Robinhood');
  return path.join(process.env.XDG_DATA_HOME ?? path.join(homedir(), '.local', 'share'), 'robinhood');
}

async function main(): Promise<void> {
  if (process.argv[2] === 'demo') { await demo(text => console.log(terminalText(text))); return; }
  const { values } = parseArgs({ options: { workspace: { type: 'string' }, 'data-dir': { type: 'string' }, session: { type: 'string' }, help: { type: 'boolean' }, version: { type: 'boolean' } } });
  if (values.help) { console.log(help); return; }
  if (values.version) { console.log('0.0.1'); return; }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('An interactive terminal is required. Run npm run demo for an account-free check.');
  const workspace = await realpath(path.resolve(values.workspace ?? process.cwd()));
  const secrets = new Secrets();
  const store = new Store(path.join(path.resolve(values['data-dir'] ?? dataPath()), 'sessions.db'));
  const terminal = new Terminal(secrets);
  let current: Session | undefined;
  let provider: OpenRouter | undefined;
  let routes: Route[] = [];
  let active: AbortController | undefined;
  const interrupt = () => { if (active) active.abort(new Error('Cancelled by user')); else terminal.close(); };
  terminal.rl.on('SIGINT', interrupt);
  process.on('SIGINT', interrupt);
  const ui: Interaction = {
    text: text => terminal.text(text), status: text => terminal.line(text),
    approve: async (description, signal) => {
      terminal.line(`\nApproval required\n${description}`);
      return (await terminal.question('Allow this operation once? [y/N] ', signal)).trim().toLowerCase() === 'y';
    },
  };
  const load = (id: string) => {
    const session = store.get(id);
    if (session.workspace !== workspace) throw new Error(`Session belongs to ${session.workspace}. Launch Robinhood in that workspace to resume it.`);
    current = session;
    terminal.line(`Resumed ${session.id}\nObjective: ${session.objective}`);
  };
  const required = (): Session => { if (!current) throw new Error('Start a task or /resume a saved session first.'); return current; };
  try {
    terminal.line(`\nROBINHOOD / developer preview\nWorkspace: ${workspace}\nFree OpenRouter routes only. /help for commands; /connect to begin.`);
    if (process.env.OPENROUTER_API_KEY) {
      secrets.add(process.env.OPENROUTER_API_KEY);
      provider = new OpenRouter(process.env.OPENROUTER_API_KEY);
      terminal.line('Loaded OPENROUTER_API_KEY for this process. Use /models, then /use MODEL.');
    }
    if (values.session) load(values.session);
    while (true) {
      let input: string;
      try { input = (await terminal.question('\nYou > ')).trim(); } catch { break; }
      if (!input) continue;
      try {
        const [command = '', ...pieces] = input.split(/\s+/);
        const argument = pieces.join(' ');
        if (command === '/quit' || command === '/exit') break;
        if (command === '/help') { terminal.line(help); continue; }
        if (command === '/connect') {
          if (argument && argument !== 'openrouter') throw new Error('This preview implements OpenRouter only. Other providers are on the roadmap.');
          terminal.line('Your task context and approved tool results will be sent to OpenRouter and its selected model provider.');
          const key = await terminal.password();
          if (!key) throw new Error('No key entered.');
          secrets.add(key);
          provider = new OpenRouter(key);
          routes = [];
          terminal.line('Key loaded. API access will be checked on your first request. Use /models, then /use MODEL.');
          continue;
        }
        if (command === '/disconnect') { provider = undefined; routes = []; terminal.line('Provider connection dropped. No credentials were stored on disk.'); continue; }
        if (command === '/models') {
          const models = await (provider ?? new OpenRouter('')).models();
          terminal.line(models.length ? models.map(model => `${model.id}  (context ${model.context.toLocaleString()})`).join('\n') : 'No eligible free tool-capable models are currently available.');
          continue;
        }
        if (command === '/use' || command === '/switch') {
          if (!provider) throw new Error('Use /connect first.');
          if (!(await provider.models()).some(model => model.id === argument)) throw new Error('Choose an eligible model ID from /models.');
          routes = [provider.route(argument)];
          terminal.line(`Selected ${argument}. Pricing is rechecked before every model request.`);
          continue;
        }
        if (command === '/providers') { terminal.line(`OpenRouter: ${provider ? 'key loaded for this process' : 'not connected'}\nSelected route: ${routes[0]?.id ?? 'none'}\nGemini / Groq / official agent logins: not implemented yet.`); continue; }
        if (command === '/new') { current = undefined; terminal.line('Your next message will start a new saved task.'); continue; }
        if (command === '/sessions') { terminal.line(store.list().map(session => `${session.id}  ${session.objective.slice(0, 80)}\n  ${session.workspace}`).join('\n') || 'No saved sessions.'); continue; }
        if (command === '/resume') { load(argument); continue; }
        if (command === '/memory') {
          const session = required();
          terminal.line(`Objective: ${session.objective}\n${JSON.stringify(store.messages(session.id), null, 2)}`);
          continue;
        }
        if (command === '/pending') { terminal.line(JSON.stringify(store.operations(required().id).filter(op => op.state === 'unknown' || op.state === 'running'), null, 2)); continue; }
        if (command === '/resolve') {
          const [id, ...note] = pieces;
          const operations = store.operations(required().id).filter(op => (op.state === 'unknown' || op.state === 'running') && id && op.id.startsWith(id));
          if (operations.length !== 1 || !note.length) throw new Error('Use /resolve UNIQUE_OPERATION_ID OUTCOME_YOU_VERIFIED. Inspect /pending first.');
          const op = operations[0]!;
          terminal.line(`${op.name}: ${op.args}\nYour verified outcome: ${note.join(' ')}`);
          if ((await terminal.question('Record this outcome without rerunning the tool? [y/N] ')).toLowerCase() === 'y') store.finish(op.id, 'completed', secrets.redact(`User-reconciled outcome (not an automatically observed result): ${note.join(' ')}`));
          continue;
        }
        if (command === '/reconcile') {
          const session = required();
          const identity = await workspaceIdentity(workspace);
          terminal.line(`Saved workspace state: ${session.identity}\nCurrent workspace state: ${identity}\nInspect external edits and checkout changes before proceeding.`);
          if ((await terminal.question('Have you reviewed and accepted this workspace state? [y/N] ')).toLowerCase() === 'y') current = store.reconcileWorkspace(session.id, identity);
          continue;
        }
        if (command === '/status') {
          const session = required();
          terminal.line(`Session: ${session.id}\nAllowance remaining: unknown. Events below describe only this app's observed activity.\n${JSON.stringify(store.events(session.id).filter(event => event.kind !== 'incomplete-output'), null, 2)}`);
          continue;
        }
        if (command === '/export') {
          if (!argument) throw new Error('Supply a new export filename.');
          const session = required();
          const payload = { format: 'robinhood-session-v1', session, messages: store.messages(session.id), operations: store.operations(session.id), events: store.events(session.id) };
          terminal.line(`Export ${payload.messages.length} messages and ${payload.operations.length} tool records to ${path.resolve(argument)}. This includes project content. Inspect /memory first if needed.`);
          if ((await terminal.question('Write this export? [y/N] ')).toLowerCase() === 'y') {
            await writeFile(path.resolve(argument), secrets.redact(JSON.stringify(payload, null, 2)) + '\n', { flag: 'wx', mode: 0o600 });
            terminal.line('Export saved. Existing files were not overwritten.');
          }
          continue;
        }
        if (command === '/delete') {
          const session = required();
          if ((await terminal.question('Delete this saved session? Workspace files and prior exports remain. [y/N] ')).toLowerCase() === 'y') { store.delete(session.id); current = undefined; terminal.line('Session deleted from the application database; this is not forensic disk erasure.'); }
          continue;
        }
        if (command.startsWith('/') && command !== '/continue') throw new Error('Unknown command. Use /help.');
        if (!routes.length) throw new Error('Use /connect and /use MODEL before starting a task.');
        if (command === '/continue') required();
        if (!current) current = store.create(workspace, await workspaceIdentity(workspace), secrets.redact(input));
        terminal.line(`Session ${current.id} | ${routes[0]!.id}`);
        active = new AbortController();
        try { await new Runner(store, secrets).turn(current, command === '/continue' ? undefined : input, routes, ui, active.signal); }
        finally { active = undefined; }
      } catch (error) { terminal.line(`Paused: ${secrets.redact(String(error))}`); }
    }
  } finally {
    process.removeListener('SIGINT', interrupt);
    terminal.close();
    store.close();
  }
}

main().catch(error => { console.error(terminalText(String(error))); process.exitCode = 1; });
