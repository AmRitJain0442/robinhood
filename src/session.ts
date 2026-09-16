import { Store } from './storage.js';
import { Secrets } from './privacy.js';
import { UnknownOutcome, workspaceIdentity } from './tools.js';
import { RouteError, type Route, type Session } from './types.js';
import { Capabilities } from './capabilities.js';
import { systemPrompt, systemPromptHash } from './prompt.js';

export interface Interaction {
  text(text: string): void;
  status(text: string): void;
  approve(description: string, signal: AbortSignal): Promise<boolean>;
  approveRequest?(description: string, signal: AbortSignal): Promise<boolean>;
  question?(question: string, signal: AbortSignal): Promise<string>;
}



export class Runner {
  constructor(readonly store: Store, readonly secrets = new Secrets(), readonly capabilities = new Capabilities()) {}

  async turn(session: Session, prompt: string | undefined, routes: Route[], ui: Interaction, signal: AbortSignal): Promise<void> {
    if (!routes.length) throw new Error('Connect and select an eligible route first.');
    if (session.identity !== await workspaceIdentity(session.workspace)) throw new Error('Workspace identity or Git HEAD changed. Inspect the workspace, then use /reconcile before continuing.');
    if (this.store.operations(session.id).some(op => op.state === 'unknown' || op.state === 'running')) throw new Error('A previous tool has an unknown outcome. Use /pending and /resolve before continuing.');
    if (prompt?.trim()) this.store.append(session.id, { role: 'user', content: this.secrets.redact(prompt) });
    let index = 0;
    this.store.selectRoute(session.id, routes[0]!.id);
    for (let step = 0; step < 12; step++) {
      signal.throwIfAborted();
      const route = routes[index]!;
      let partial = '';
      let completion;
      const display = this.secrets.stream(text => ui.text(text));
      try {
        let confirmed = false;
        if (route.manualApproval) {
          confirmed = await ui.approveRequest?.(`${route.id}\n${route.manualApproval}`, signal) ?? false;
          if (!confirmed) throw new RouteError('Request not sent: account-dependent access was not approved.', 'policy');
        }
        this.store.event(session.id, 'request-attempt', { route: route.id, promptHash: systemPromptHash });
        completion = await route.complete([
          { role: 'system', content: `${systemPrompt}\nTask objective: ${session.objective}` },
          { role: 'system', content: `Plan mode: ${this.store.state(session.id, 'plan-mode', false)}. Task checklist: ${JSON.stringify(this.store.state(session.id, 'todos', []))}. User goal: ${JSON.stringify(this.store.state(session.id, 'goal', null))}.` },
          ...this.store.context(session.id),
        ], signal, text => { partial += text; display.write(text); }, { confirmed }, { tools: this.capabilities.catalog(this.store.state(session.id, 'plan-mode', false)) });
        display.flush();
      } catch (error) {
        display.flush();
        if (partial) this.store.event(session.id, 'incomplete-output', { route: route.id, text: this.secrets.redact(partial) });
        this.store.event(session.id, 'request-error', { route: route.id, message: this.secrets.redact(String(error)), kind: error instanceof RouteError ? error.kind : 'unknown' });
        if (!signal.aborted && error instanceof RouteError && ['quota', 'capacity'].includes(error.kind) && index + 1 < routes.length) {
          ui.status(`${error.message} Saved state; switching to ${routes[++index]!.id}.`);
          this.store.selectRoute(session.id, routes[index]!.id);
          continue;
        }
        throw error;
      }
      const message = JSON.parse(this.secrets.redact(JSON.stringify(completion.message))) as typeof completion.message;
      message.source = { provider: route.provider, model: route.model };
      const operations = this.store.prepare(session.id, message, completion.usage);
      if (!operations.length) return;
      for (const op of operations) {
        if (signal.aborted) {
          this.store.finish(op.id, 'failed', 'Cancelled before execution. No action was launched.');
          continue;
        }
        let tool;
        try {
          tool = await this.capabilities.prepare({ store: this.store, session, question: ui.question }, op.name, op.args);
          if (!await ui.approve(this.secrets.redact(tool.description), signal)) {
            this.store.finish(op.id, 'failed', 'User denied this operation. It was not executed.');
            continue;
          }
        } catch (error) {
          this.store.finish(op.id, 'failed', this.secrets.redact(`Not executed: ${String(error)}`));
          continue;
        }
        // This write must succeed before any external side effect is launched.
        this.store.running(op.id);
        let state: 'completed' | 'failed' = 'completed';
        let result: string;
        try { result = await tool.execute(signal); } catch (error) {
          if (error instanceof UnknownOutcome) {
            this.store.uncertain(op.id, this.secrets.redact(error.message));
            for (const pending of operations.filter(item => item.id !== op.id)) {
              if (this.store.operations(session.id).find(item => item.id === pending.id)?.state === 'prepared') this.store.finish(pending.id, 'failed', 'Paused before execution because an earlier operation needs reconciliation.');
            }
            throw error;
          }
          state = 'failed';
          result = String(error);
        }
        // A failed receipt write propagates. Never convert it into a retry of the tool.
        this.store.finish(op.id, state, this.secrets.redact(result));
        ui.status(`${op.name}: ${state}. Receipt ${op.id.slice(0, 8)} saved.`);
      }
    }
    ui.status('Paused after 12 model steps. Task state is saved; use /continue to proceed.');
  }
}
