import type { Store } from './storage.js';
import type { Session, ToolDefinition } from './types.js';
import { prepareTool, toolDefinitions, type PreparedTool } from './tools.js';
import { Jobs } from './jobs.js';

export interface Todo { id: string; text: string; status: 'pending' | 'in_progress' | 'completed' }
export interface CapabilityContext {
  store: Store; session: Session;
  question?(question: string, signal: AbortSignal): Promise<string>;
}
const schema = (name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolDefinition => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
const jobTools = [
  schema('job_start', 'Start an explicitly requested background shell job after approval. Up to 10 minutes and 32 KiB output. Stops when Robinhood exits.', { command: { type: 'string' } }, ['command']),
  schema('job_list', 'Inspect this session background jobs and saved outcomes.', {}, []),
  schema('job_stop', 'Stop a background job owned by this Robinhood process and collect its outcome.', { id: { type: 'string' } }, ['id']),
];
export const taskTools = [
  schema('todo_read', 'Read the durable task checklist.', {}, []),
  schema('todo_write', 'Replace the durable checklist. Track actual progress; do not invent completed work.', { items: { type: 'array', maxItems: 50, items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } }, required: ['id', 'text', 'status'], additionalProperties: false } } }, ['items']),
  schema('ask_user', 'Ask the user for missing information and wait for their answer.', { question: { type: 'string' } }, ['question']),
  schema('goal_read', 'Read the user-created objective and its recorded status. Only the user creates or changes objectives.', {}, []),
  schema('goal_complete', 'Propose marking the user-created goal complete, with evidence. Requires user approval.', { evidence: { type: 'string' } }, ['evidence']),
];
export const readOnlyTools = new Set(['list_files', 'read_file', 'glob_files', 'search_files', 'todo_read', 'todo_write', 'ask_user', 'goal_read', 'job_list']);

export class Capabilities {
  constructor(readonly jobs = new Jobs()) {}
  definitions: ToolDefinition[] = [...toolDefinitions, ...taskTools, ...jobTools];
  catalog(planning: boolean): ToolDefinition[] { return this.definitions.filter(tool => !planning || readOnlyTools.has(tool.function.name)); }
  async prepare(context: CapabilityContext, name: string, raw: string): Promise<PreparedTool> {
    const { store, session } = context;
    if (store.state(session.id, 'plan-mode', false) && !readOnlyTools.has(name)) throw new Error('Plan mode permits read-only workspace tools. Use /plan off before changing files or running commands.');
    if (jobTools.some(tool => tool.function.name === name)) {
      const args = JSON.parse(raw) as Record<string, unknown>;
      if (name === 'job_list') return { description: 'Inspect background jobs', execute: async () => JSON.stringify(this.jobs.list(store, session)) };
      if (name === 'job_start' && typeof args.command === 'string') {
        const command = args.command;
        return { description: `Start background command (10-minute deadline):\n${command}`, execute: async signal => { signal.throwIfAborted(); return JSON.stringify(this.jobs.start(store, session, command)); } };
      }
      if (name === 'job_stop' && typeof args.id === 'string') {
        const id = args.id;
        return { description: `Stop job ${id}`, execute: async () => JSON.stringify(await this.jobs.stop(store, session, id)) };
      }
      throw new Error('Invalid background job arguments.');
    }
    if (!taskTools.some(tool => tool.function.name === name)) return prepareTool(session.workspace, name, raw);
    const args = JSON.parse(raw) as Record<string, unknown>;
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Expected tool argument object.');
    if (name === 'todo_read') return { description: 'Read the saved task checklist', execute: async () => JSON.stringify(store.state(session.id, 'todos', [])) };
    if (name === 'goal_read') return { description: 'Read the user-created goal', execute: async () => JSON.stringify(store.state(session.id, 'goal', null)) };
    if (name === 'todo_write') {
      if (!Array.isArray(args.items) || args.items.length > 50) throw new Error('Supply at most 50 checklist items.');
      const items = args.items as Todo[];
      if (items.some(item => !item || typeof item.id !== 'string' || !item.id || item.id.length > 64 || typeof item.text !== 'string' || !item.text || item.text.length > 1000 || !['pending', 'in_progress', 'completed'].includes(item.status)) || new Set(items.map(item => item.id)).size !== items.length) throw new Error('Invalid checklist items.');
      return { description: `Update checklist:\n${items.map(item => `[${item.status}] ${item.text}`).join('\n')}`, execute: async signal => { signal.throwIfAborted(); store.event(session.id, 'todos', items); return JSON.stringify(items); } };
    }
    if (name === 'goal_complete') {
      const goal = store.state<{ text: string; status: string } | null>(session.id, 'goal', null);
      if (!goal || goal.status !== 'active') throw new Error('No active user-created goal.');
      if (typeof args.evidence !== 'string' || !args.evidence.trim() || args.evidence.length > 4000) throw new Error('Supply concise completion evidence.');
      return { description: `Mark goal complete: ${goal.text}\nEvidence: ${args.evidence}`, execute: async signal => { signal.throwIfAborted(); store.event(session.id, 'goal', { ...goal, status: 'completed', evidence: args.evidence }); return 'Goal marked complete after approval.'; } };
    }
    if (typeof args.question !== 'string' || !args.question.trim() || args.question.length > 2000 || !context.question) throw new Error('A question and interactive terminal are required.');
    const question = args.question;
    return { description: `Ask: ${question}`, execute: signal => context.question!(question, signal) };
  }
}
