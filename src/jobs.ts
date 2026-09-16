import { randomUUID } from 'node:crypto';
import { runCommand, UnknownOutcome } from './tools.js';
import type { Store } from './storage.js';
import type { Session } from './types.js';
import { Secrets } from './privacy.js';

export interface Job { id: string; command: string; status: 'running' | 'completed' | 'failed' | 'unknown'; pid?: number; result?: string }
export class Jobs {
  private active = new Map<string, { session: string; controller: AbortController; done: Promise<void> }>();
  constructor(private readonly secrets = new Secrets()) {}
  list(store: Store, session: Session): Job[] {
    const latest = new Map<string, Job>();
    for (const event of store.events(session.id).filter(event => event.kind === 'job')) {
      const job = event.body as Job;
      latest.set(job.id, job.status === 'running' && !this.active.has(job.id) ? { ...job, status: 'unknown' } : job);
    }
    return [...latest.values()];
  }
  start(store: Store, session: Session, command: string): Job {
    if (this.active.size >= 4) throw new Error('At most four background jobs may run. Stop or collect one first.');
    if (!command.trim() || command.length > 4000 || command.includes('\0')) throw new Error('Invalid background command.');
    const job: Job = { id: randomUUID(), command: this.secrets.redact(command), status: 'running' };
    store.event(session.id, 'job', job);
    const controller = new AbortController();
    // Defer launch until the handle is registered, and retain outcomes in SQLite.
    const done = Promise.resolve().then(async () => {
      try {
        const execution = runCommand(session.workspace, command, controller.signal, 600_000, pid => { job.pid = pid; });
        try { store.event(session.id, 'job', job); }
        catch (error) { controller.abort(); await execution.catch(() => {}); throw error; }
        const result = await execution;
        const outcome = JSON.parse(result) as { exitCode: number | null; stopped: string | null };
        job.status = outcome.exitCode === 0 && !outcome.stopped ? 'completed' : 'failed';
        job.result = this.secrets.redact(result);
      } catch (error) { job.status = error instanceof UnknownOutcome ? 'unknown' : 'failed'; job.result = this.secrets.redact(String(error)); }
      store.event(session.id, 'job', job);
    }).finally(() => { this.active.delete(job.id); });
    void done.catch(() => {});
    this.active.set(job.id, { session: session.id, controller, done });
    return { ...job };
  }
  async stop(store: Store, session: Session, id: string): Promise<Job> {
    const handle = this.active.get(id);
    if (!handle || handle.session !== session.id) throw new Error('This process does not own that active job. Inspect an interrupted job before reconciling it.');
    handle.controller.abort(); await handle.done;
    return this.list(store, session).find(job => job.id === id)!;
  }
  resolve(store: Store, session: Session, id: string, note: string): void {
    const job = this.list(store, session).find(job => job.id === id);
    if (!job || job.status !== 'unknown' || !note.trim()) throw new Error('Only an unknown job with a verified outcome can be reconciled.');
    store.event(session.id, 'job', { ...job, status: 'completed', result: this.secrets.redact(`User-reconciled outcome: ${note}`) });
  }
  async close(): Promise<void> {
    const handles = [...this.active.values()];
    for (const handle of handles) handle.controller.abort();
    const outcomes = await Promise.allSettled(handles.map(handle => handle.done));
    const failure = outcomes.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
}
