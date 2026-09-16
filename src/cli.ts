#!/usr/bin/env node
import { setupGuides, accountPriority } from './auth/catalog.js';
import { Terminal } from './ui/terminal.js';
import { systemVault, type AccountVault, type SavedAccount } from './auth/vault.js';
import { browserLogin, openBrowser, openRouterFlow, puterFlow } from './auth/browser.js';
import { parseArgs } from 'node:util';
import { dataPath } from './paths.js';
import { loginGemini } from './bridges/gemini-cli.js';
import { loginCopilot } from './bridges/copilot.js';
import { realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OpenRouter } from './providers/openrouter.js';
import { providers, providerDefinition } from './providers/registry.js';
import { Runner, type Interaction } from './session.js';
import { Store } from './storage.js';
import { Secrets, terminalText } from './privacy.js';
import { workspaceIdentity } from './tools.js';
import { demo } from './demo.js';
import type { Connector, Route, Session } from './types.js';
import { Capabilities } from './capabilities.js';
import { compactSession } from './context.js';
import { systemPrompt, systemPromptHash } from './prompt.js';
import { Jobs } from './jobs.js';
import { listSkills, loadSkill, loadPlugin, loadMcp } from './extensions.js';
import { delegateTask } from './delegation.js';
import { Terminals } from './terminals.js';

const help = `Robinhood 0.0.1 / developer preview

  robinhood                           Open in the current project directory
  robinhood --workspace <directory>    Open a specific project
  robinhood demo                      Offline handoff demonstration
  robinhood login gemini-cli           Sign in with Google in the native CLI
  robinhood login copilot-cli          Sign in with GitHub in the native CLI

Options: --workspace PATH, --data-dir PATH, --session ID, --help, --version

In the terminal:
  /connect [PROVIDER]     Link an account; browser login where supported
  /models [PROVIDER]      Search and select a supported model
  /use [PROVIDER] MODEL   Switch the current session to a connected provider/model
  /accounts               Search and link provider accounts
  /providers              Connection and selected route
  /new                    Start a new task with your next message
  /sessions               List saved sessions
  /resume ID              Resume a session in this workspace
  /continue               Continue the saved task without adding a new message
  /memory                 Inspect the task's saved conversation
  /prompt                 Inspect the active system prompt and fingerprint
  /plan on|off            Toggle read-only planning for this session
  /todos                  Inspect the durable task checklist
  /goal TEXT              Set an explicit goal; /goal shows its status
  /fork [OBJECTIVE]       Branch this task, preserving completed receipts
  /compact                Review a model summary for shorter context
  /jobs                   Inspect background jobs and outcomes
  /job-stop ID            Stop an owned background job
  /job-resolve ID NOTE    Record an interrupted job outcome you verified
  /skills, /skill NAME    Discover and activate workspace SKILL.md instructions
  /plugin FILE           Load an explicitly trusted local JavaScript plugin
  /mcp CONFIG.json       Connect an explicitly trusted MCP server
  /extensions            List loaded extensions; /unload NAME disconnects one
  /delegate TASK          Run a read-only research agent and bring back its report
  /search TEXT            Search saved session objectives and conversation text
  /terminals              List persistent shells; /terminal-close ID stops one
  /terminal-resolve ID NOTE  Reconcile an interrupted shell after inspection
  /pending                Inspect operations needing reconciliation
  /resolve ID NOTE        Record the outcome you verified for an uncertain operation
  /reconcile              Accept a changed checkout after inspecting the workspace
  /status                 Inspect locally observed requests and usage
  /export PATH            Export this session after confirmation; never overwrite a file
  /delete                 Delete this session after confirmation
  /disconnect             Unlink account and remove its saved credential
  /quit                   Save and exit

Providers: ${providers.map(provider => provider.id).join(', ')}.
Account-dependent routes require explicit confirmation for each request.
Provider integration does not guarantee free account eligibility or remaining tokens.
All tool calls require approval. Approved commands have your OS privileges.
Ctrl+C cancels an active turn; Ctrl+C at the prompt exits. No telemetry.`;

async function main(): Promise<void> {
  if (process.argv[2] === 'login') {
    if (process.argv.length !== 4 || !['gemini-cli', 'copilot-cli'].includes(process.argv[3]!)) throw new Error('Use: robinhood login gemini-cli OR robinhood login copilot-cli');
    if (process.argv[3] === 'gemini-cli') await loginGemini(); else await loginCopilot();
    return;
  }
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
  const connections = new Map<string, Connector>();
  let selectedProvider = 'openrouter';
  let routes: Route[] = [];
  let active: AbortController | undefined;
  let vault: AccountVault | undefined;
  const capabilities = new Capabilities(new Jobs(secrets), new Terminals(secrets));
  const interrupt = () => { if (active) active.abort(new Error('Cancelled by user')); else terminal.close(); };
  terminal.rl.on('SIGINT', interrupt);
  process.on('SIGINT', interrupt);
  const ui: Interaction = {
    text: text => terminal.text(text), status: text => terminal.line(text),
    question: (question, signal) => terminal.question(question, signal),
    approve: async (description, signal) => {
      terminal.line(`\nApproval required\n${description}`);
      return (await terminal.question('Allow this operation once? [y/N] ', signal)).trim().toLowerCase() === 'y';
    },
    approveRequest: async (description, signal) => {
      terminal.line(`\nAccount access confirmation\n${description}`);
      return (await terminal.question('Send this one request using this account? [y/N] ', signal)).trim().toLowerCase() === 'y';
    },
  };
  const load = (id: string) => {
    const session = store.get(id);
    if (session.workspace !== workspace) throw new Error(`Session belongs to ${session.workspace}. Launch Robinhood in that workspace to resume it.`);
    current = session;
    terminal.line(`Resumed ${session.id}\nObjective: ${session.objective}`);
  };
  const required = (): Session => { if (!current) throw new Error('Start a task or /resume a saved session first.'); return current; };
  const listModels = async (connection: Connector) => {
    active = new AbortController();
    try { const models = await connection.models(active.signal); active.signal.throwIfAborted(); return models; }
    finally { active = undefined; }
  };
  try {
    terminal.line(`Your workspace. Your accounts.\n${workspace}\n\n/connect   Link an account or start without login\n/models    Search models across a connected provider\n/help      Commands, memory and approvals`);
    try { vault = await systemVault(); } catch { terminal.line('OS credential vault unavailable. Connections will last for this process only.'); }
    for (const entry of providers) {
      let saved: SavedAccount | undefined;
      try { saved = await vault?.load(entry.id); } catch { terminal.line(`Could not restore ${entry.id} from the OS vault; reconnect if needed.`); }
      const key = process.env[entry.env] ?? saved?.key;
      if (key === undefined) continue;
      secrets.add(key);
      try {
        connections.set(entry.id, entry.create(key, entry.configuration ? process.env[entry.configuration.env] ?? saved?.configuration : undefined));
        terminal.line(`Restored ${entry.name} (${process.env[entry.env] ? 'environment' : 'OS vault'}).`);
      } catch { terminal.line(`Could not configure ${entry.name}; use /connect ${entry.id} to complete setup.`); }
    }
    if (values.session) load(values.session);
    while (true) {
      terminal.setContext({ workspace, route: routes[0]?.id ?? 'Choose a model /models', accounts: connections.size, session: current?.id ?? 'New task' });
      let input: string;
      try { input = (await terminal.question('\nYou > ')).trim(); } catch { break; }
      if (!input) continue;
      try {
        const [command = '', ...pieces] = input.split(/\s+/);
        const argument = pieces.join(' ');
        if (command === '/quit' || command === '/exit') break;
        if (command === '/help') { terminal.line(help); continue; }
        if (command === '/connect' || command === '/accounts') {
          const id = argument || await terminal.select('Link an account - type to search', [...providers].sort((a, b) => accountPriority(a.id) - accountPriority(b.id)).map(entry => ({ value: entry.id, label: entry.name, detail: `${connections.has(entry.id) ? 'connected / ' : ''}${entry.bridge ? (entry.bridge.login ? 'native account login' : 'CLI free-model bridge') : ['openrouter', 'puter'].includes(entry.id) ? 'browser sign-in' : entry.anonymous ? 'anonymous access available' : 'one-time API credential'}` })));
          const entry = providerDefinition(id);
          const flow = id === 'openrouter' ? openRouterFlow : id === 'puter' ? puterFlow : undefined;
          const method = await terminal.select(`Connect ${entry.name}`, [
            ...(flow ? [{ value: 'browser', label: 'Sign in with your browser', detail: id === 'puter' ? 'experimental Puter integration' : 'authorize Robinhood on OpenRouter' }] : []),
            ...(entry.anonymous || entry.bridge ? [{ value: 'anonymous', label: entry.bridge?.label ?? 'Continue without an account', detail: entry.bridge?.login ?? 'shared limits apply' }] : []),
            ...(entry.bridge ? [] : [{ value: 'key', label: 'Use an API credential', detail: 'saved in your OS credential vault' }]),
            ...(setupGuides[id] && !entry.bridge ? [{ value: 'setup', label: 'Open official account setup', detail: 'sign in there, then paste a credential once' }] : []),
          ]);
          terminal.line(`Task context goes to ${entry.name} and its upstream services. ${entry.access}.`);
          let key = '';
          if (method === 'browser' && flow) {
            active = new AbortController();
            terminal.line('Opening provider sign-in. Use Google there if offered. Authorize this provider once; Ctrl+C cancels.');
            try {
              key = await browserLogin(flow, async url => {
                terminal.line(`If your browser does not open, visit:\n${url}`);
                try { await openBrowser(url); } catch { terminal.line('Automatic browser launch failed. Open the URL above manually.'); }
              }, active.signal);
            } finally { active = undefined; }
          } else if (method === 'key' || method === 'setup') {
            if (method === 'setup') {
              terminal.line(`Official setup: ${setupGuides[id]}`);
              try { await openBrowser(setupGuides[id]!); } catch { terminal.line('Open the setup URL above manually.'); }
            }
            terminal.line(`Create a credential in your ${entry.name} account, then paste it here. A Google session does not grant API access to unrelated providers.`);
            key = (await terminal.password(entry.name)).trim();
            if (!key) throw new Error('No credential entered. Existing connection was kept.');
          }
          if (key) secrets.add(key);
          const configuration = entry.configuration ? process.env[entry.configuration.env] ?? (await terminal.question(`${entry.configuration.prompt}: `)).trim() : undefined;
          const connection = entry.create(key, configuration);
          await connections.get(entry.id)?.close?.();
          connections.set(entry.id, connection);
          selectedProvider = entry.id;
          routes = [];
          if (vault) {
            try { await vault.save(entry.id, { key, configuration, method }); terminal.line(entry.bridge ? 'CLI connection saved. The native CLI manages any account authorization.' : 'Account linked and saved in the OS credential vault.'); }
            catch { terminal.line('Connected for this process only: the OS vault could not save this credential. Any older saved credential remains unchanged.'); }
          } else terminal.line('Connected for this process only: no OS credential vault is available.');
          if (entry.bridge?.login) terminal.line(entry.bridge.login);
          terminal.line('Use /models to choose a model. Access and remaining allowance are checked by the provider; linking does not create credits.');
          continue;
        }
        if (command === '/disconnect') {
          const id = argument || selectedProvider;
          providerDefinition(id);
          if (vault) await vault.remove(id);
          await connections.get(id)?.close?.();
          connections.delete(id);
          routes = routes.filter(route => route.provider !== id);
          terminal.line(`${id} unlinked and saved credential removed. Environment credentials, if set, will reload on restart.`);
          continue;
        }
        if (command === '/models') {
          const id = argument || selectedProvider;
          const entry = providerDefinition(id);
          const connection = connections.get(id) ?? (id === 'openrouter' ? new OpenRouter('') : undefined);
          if (!connection) throw new Error(`Use /connect ${id} first.`);
          const models = await listModels(connection);
          if (!models.length) throw new Error('No supported models are currently available.');
          const model = await terminal.select(`${entry.name} - choose a model`, models.map(model => ({ value: model.id, label: model.id, detail: `${model.context.toLocaleString()} context` })));
          if (!connections.has(id)) throw new Error(`Use /connect ${id} before selecting a model.`);
          routes = [connection.route(model)]; selectedProvider = id;
          terminal.line(`Selected ${id}/${model}. ${entry.access}.`);
          continue;
        }
        if (command === '/use' || command === '/switch') {
          const id = pieces.length > 1 ? pieces[0]! : selectedProvider;
          const model = pieces.length > 1 ? pieces.slice(1).join(' ') : argument;
          const entry = providerDefinition(id);
          const connection = connections.get(id);
          if (!connection) throw new Error(`Use /connect ${id} first.`);
          if (!(await listModels(connection)).some(item => item.id === model)) throw new Error(`Choose a model ID from /models ${id}.`);
          routes = [connection.route(model)];
          selectedProvider = id;
          terminal.line(`Selected ${id}/${model}. ${entry.access}. Saved task history stays in this session.`);
          continue;
        }
        if (command === '/providers') { terminal.line(`${providers.map(entry => `${entry.id}: ${connections.has(entry.id) ? 'connected' : 'not connected'} — ${entry.access}`).join('\n')}\nSelected route: ${routes[0]?.id ?? 'none'}`); continue; }
        if (command === '/prompt') { terminal.line(`System prompt ${systemPromptHash}\n${systemPrompt}`); continue; }
        if (command === '/search') {
          if (!argument) throw new Error('Supply search text.');
          const query = argument.toLowerCase();
          const matches = store.list().filter(session => session.workspace === workspace && (session.objective.toLowerCase().includes(query) || store.messages(session.id).some(message => message.content?.toLowerCase().includes(query))));
          terminal.line(matches.slice(0, 50).map(session => `${session.id}  ${session.objective}`).join('\n') || 'No matching sessions.'); continue;
        }
        if (command === '/delegate') {
          if (!routes[0]) throw new Error('Select a model before delegating.');
          active = new AbortController();
          try { await delegateTask(store, required(), argument, routes[0], ui, secrets, capabilities, active.signal); }
          finally { active = undefined; }
          continue;
        }
        if (command === '/skills') { terminal.line((await listSkills(workspace)).join('\n') || 'No skills in .agents/skills/*/SKILL.md.'); continue; }
        if (command === '/skill') {
          const content = secrets.redact(await loadSkill(workspace, argument));
          terminal.line(`Skill ${argument}:\n${content}`);
          if (!current) current = store.create(workspace, await workspaceIdentity(workspace), `Work with skill ${argument}`);
          store.event(current.id, 'active-skill', { name: argument, content });
          terminal.line('Skill activated for this session. It supplies instructions, not additional permissions.'); continue;
        }
        if (command === '/extensions') { terminal.line(capabilities.names().join('\n') || 'No extensions loaded.'); continue; }
        if (command === '/unload') { await capabilities.unload(argument); terminal.line(`Unloaded ${argument}.`); continue; }
        if (command === '/plugin' || command === '/mcp') {
          if (!argument) throw new Error(`Use ${command} FILE.`);
          active = new AbortController();
          try {
            if (await ui.approve(`Load ${path.resolve(argument)}?\nLocal plugin/server code runs with your OS privileges. Remote MCP sends approved arguments to its configured service. Only load a file you trust.`, active.signal)) {
              const name = command === '/plugin' ? await loadPlugin(path.resolve(argument), capabilities) : await loadMcp(path.resolve(argument), capabilities, active.signal);
              terminal.line(`Loaded ${name}. Its model tool calls require approval; plan mode blocks extension tools.`);
            }
          } finally { active = undefined; }
          continue;
        }
        if (command === '/jobs') { terminal.line(JSON.stringify(capabilities.jobs.list(store, required()), null, 2)); continue; }
        if (command === '/terminals') { terminal.line(JSON.stringify(capabilities.terminals.list(store, required()), null, 2)); continue; }
        if (command === '/terminal-close') { await capabilities.terminals.stop(required().id, argument); terminal.line('Terminal closed.'); continue; }
        if (command === '/terminal-resolve') { capabilities.terminals.resolve(store, required(), pieces[0] ?? '', pieces.slice(1).join(' ')); terminal.line('Terminal outcome recorded.'); continue; }
        if (command === '/job-stop') { terminal.line(JSON.stringify(await capabilities.jobs.stop(store, required(), argument), null, 2)); continue; }
        if (command === '/job-resolve') { capabilities.jobs.resolve(store, required(), pieces[0] ?? '', pieces.slice(1).join(' ')); terminal.line('Verified job outcome recorded.'); continue; }
        if (command === '/plan') {
          if (!['on', 'off'].includes(argument)) throw new Error('Use /plan on or /plan off.');
          if (!current) current = store.create(workspace, await workspaceIdentity(workspace), 'Plan a task');
          store.event(current.id, 'plan-mode', argument === 'on');
          terminal.line(`Plan mode ${argument}. ${argument === 'on' ? 'Workspace mutations and commands are blocked.' : 'Approved execution is available.'}`); continue;
        }
        if (command === '/todos') { terminal.line(JSON.stringify(store.state(required().id, 'todos', []), null, 2)); continue; }
        if (command === '/goal') {
          if (argument) {
            if (!current) current = store.create(workspace, await workspaceIdentity(workspace), secrets.redact(argument));
            store.event(current.id, 'goal', { text: secrets.redact(argument), status: 'active' });
          }
          terminal.line(JSON.stringify(store.state(required().id, 'goal', null), null, 2)); continue;
        }
        if (command === '/fork') { current = store.fork(required().id, secrets.redact(argument)); terminal.line(`Branched into ${current.id}. Completed tools remain completed.`); continue; }
        if (command === '/compact') {
          if (!routes[0]) throw new Error('Select a model before compacting.');
          active = new AbortController();
          try { await compactSession(store, required(), routes[0], ui, secrets, active.signal); }
          finally { active = undefined; }
          continue;
        }
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
        try { await new Runner(store, secrets, capabilities).turn(current, command === '/continue' ? undefined : input, routes, ui, active.signal); }
        finally { active = undefined; }
      } catch (error) { terminal.line(`Paused: ${secrets.redact(String(error))}`); }
    }
  } finally {
    process.removeListener('SIGINT', interrupt);
    await capabilities.close().catch(error => terminal.line(`Runtime cleanup needs inspection: ${String(error)}`));
    await Promise.allSettled([...connections.values()].map(connection => connection.close?.()));
    terminal.close();
    store.close();
  }
}

main().catch(error => { console.error(terminalText(String(error))); process.exitCode = 1; });
