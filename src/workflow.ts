import { readFile, stat } from 'node:fs/promises';
import type { Store } from './storage.js';
import type { Route, Session } from './types.js';
import { Runner, type Interaction } from './session.js';
import { Secrets } from './privacy.js';
import { Capabilities } from './capabilities.js';

export interface Workflow { name: string; steps: string[]; next: number; inFlight: boolean; startMessages?: number; status: 'ready' | 'running' | 'paused' | 'completed' }
export async function readWorkflow(filename: string): Promise<Workflow> {
  if ((await stat(filename)).size > 32000) throw new Error('Workflow file exceeds 32 KiB.');
  const value = JSON.parse(await readFile(filename, 'utf8')) as { name?: unknown; steps?: unknown };
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 || !Array.isArray(value.steps) || !value.steps.length || value.steps.length > 12 || value.steps.some(step => typeof step !== 'string' || !step.trim() || step.length > 8000)) throw new Error('Workflow needs a name and 1-12 nonempty prompt steps (at most 8000 characters each).');
  return { name: value.name, steps: value.steps, next: 0, inFlight: false, status: 'ready' };
}
export async function runWorkflow(store: Store, session: Session, route: Route, ui: Interaction, secrets: Secrets, capabilities: Capabilities, signal: AbortSignal): Promise<void> {
  const workflow = store.state<Workflow | null>(session.id, 'workflow', null);
  if (!workflow || workflow.status === 'completed') throw new Error('No unfinished workflow. Load one with /workflow FILE.');
  const save = () => store.event(session.id, 'workflow', workflow);
  while (workflow.next < workflow.steps.length) {
    signal.throwIfAborted();
    const existing = store.messages(session.id);
    if (workflow.inFlight && workflow.startMessages !== undefined && existing.length > workflow.startMessages + 1 && existing.at(-1)?.role === 'assistant' && !existing.at(-1)?.tool_calls?.length) {
      workflow.next++; workflow.inFlight = false; workflow.status = workflow.next === workflow.steps.length ? 'completed' : 'ready'; save(); continue;
    }
    ui.status(`Workflow ${workflow.name}: step ${workflow.next + 1}/${workflow.steps.length}`);
    const prompt = workflow.inFlight ? undefined : workflow.steps[workflow.next]!;
    if (!workflow.inFlight) {
      workflow.inFlight = true;
      workflow.startMessages = existing.length;
      store.appendWithEvent(session.id, { role: 'user', content: secrets.redact(prompt!) }, 'workflow', workflow);
    }
    workflow.status = 'running'; save();
    try {
      await new Runner(store, secrets, capabilities).turn(session, undefined, [route], ui, signal);
      const last = store.messages(session.id).at(-1);
      if (last?.role !== 'assistant' || last.tool_calls?.length) throw new Error('Step paused at the turn limit. Use /workflow-resume.');
      workflow.next++; workflow.inFlight = false;
      workflow.status = workflow.next === workflow.steps.length ? 'completed' : 'ready'; save();
    } catch (error) { workflow.status = 'paused'; save(); throw error; }
  }
  ui.status(`Workflow ${workflow.name} completed. Review its saved receipts and results.`);
}
