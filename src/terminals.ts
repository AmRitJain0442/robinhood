import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import type { Store } from './storage.js';
import type { Session } from './types.js';
import { Secrets, terminalText } from './privacy.js';
import { UnknownOutcome } from './tools.js';

interface TerminalState { id: string; pid: number; status: 'running' | 'closed' | 'unknown'; exitCode?: number }
interface Handle { state: TerminalState; owner: string; host: ChildProcess; output: string; bytes: number; truncated: boolean; exited: Promise<void>; timer: NodeJS.Timeout; stopping?: Promise<void> }
export class Terminals {
  private handles = new Map<string, Handle>();
  constructor(private readonly secrets = new Secrets()) {}
  list(store: Store, session: Session): TerminalState[] {
    const states = new Map<string, TerminalState>();
    for (const event of store.events(session.id).filter(event => event.kind === 'terminal')) {
      const state = event.body as TerminalState;
      states.set(state.id, state.status === 'running' && !this.handles.has(state.id) ? { ...state, status: 'unknown' } : state);
    }
    return [...states.values()];
  }
  async open(store: Store, session: Session): Promise<TerminalState> {
    if ([...this.handles.values()].filter(handle => handle.state.status === 'running').length >= 4) throw new Error('At most four persistent terminals may run.');
    const id = randomUUID();
    store.event(session.id, 'terminal', { id, pid: 0, status: 'running' });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^ROBINHOOD_/i.test(key))) as Record<string, string>;
    const host = spawn(process.execPath, [fileURLToPath(new URL('./terminal-host.js', import.meta.url))], { cwd: session.workspace, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const state: TerminalState = { id, pid: host.pid ?? 0, status: 'running' };
    let ready!: () => void, startupFailed!: (error: Error) => void;
    const started = new Promise<void>((resolve, reject) => { ready = resolve; startupFailed = reject; });
    let settle!: () => void;
    const exited = new Promise<void>(resolve => { settle = resolve; });
    const handle: Handle = { state, owner: session.id, host, output: '', bytes: 0, truncated: false, exited, timer: setTimeout(() => { void this.stop(session.id, id).catch(() => {}); }, 600000) };
    this.handles.set(id, handle);
    host.on('message', (message: { type?: string; pid?: number; data?: string; exitCode?: number }) => {
      if (message.type === 'ready' && typeof message.pid === 'number') {
        state.pid = message.pid;
        ready();
        try { store.event(session.id, 'terminal', state); } catch { void this.stop(session.id, id).catch(() => {}); }
      }
      if (message.type === 'data' && typeof message.data === 'string') {
        handle.bytes += Buffer.byteLength(message.data);
        handle.output = (handle.output + message.data).slice(-24000);
        handle.truncated = handle.bytes > Buffer.byteLength(handle.output);
        if (handle.bytes > 1024 * 1024) void this.stop(session.id, id).catch(() => {});
      }
      if (message.type === 'exit') state.exitCode = message.exitCode;
    });
    host.on('error', error => { state.status = 'unknown'; startupFailed(error); });
    host.on('close', () => {
      clearTimeout(handle.timer); state.status = state.exitCode !== undefined || handle.stopping ? 'closed' : 'unknown';
      startupFailed(new Error('Persistent shell host exited. Check optional node-pty installation and platform support.'));
    try { store.event(session.id, 'terminal', state); } catch { state.status = 'unknown'; }
      settle();
    });
    try { store.event(session.id, 'terminal', state); }
    catch (error) { await this.stop(session.id, id); throw error; }
    let startupTimer: NodeJS.Timeout | undefined;
    try { await Promise.race([started, new Promise<never>((_resolve, reject) => { startupTimer = setTimeout(() => reject(new Error('Persistent shell startup timed out.')), 15000); })]); }
    catch (error) { await this.stop(session.id, id); throw error; }
    finally { clearTimeout(startupTimer); }
    return { ...state };
  }
  read(owner: string, id: string): string {
    const handle = this.owned(owner, id);
    let output = this.secrets.redact(terminalText(handle.output));
    while (Buffer.byteLength(output) > 28000) output = output.slice(Math.floor(output.length * 0.1));
    return JSON.stringify({ ...handle.state, output, truncated: handle.truncated, note: 'Output is a terminal snapshot. Input acceptance does not prove command completion.' });
  }
  send(owner: string, id: string, text: string): string {
    const handle = this.owned(owner, id);
    if (handle.state.status !== 'running' || text.length > 4000) throw new Error('Terminal is closed or input exceeds 4000 characters.');
    if (!handle.host.connected) throw new UnknownOutcome('Terminal host disconnected. Inspect the saved PID.');
    handle.host.send({ type: 'input', text });
    return JSON.stringify({ id, accepted: true, note: 'Input sent. Read the terminal to inspect execution; do not resend automatically.' });
  }
  private owned(owner: string, id: string): Handle {
    const handle = this.handles.get(id);
    if (!handle || handle.owner !== owner) throw new Error('This session does not own that terminal.');
    return handle;
  }
  async stop(owner: string, id: string): Promise<void> {
    const handle = this.owned(owner, id);
    if (handle.state.status === 'closed') return;
    return handle.stopping ??= this.terminate(handle);
  }
  private async terminate(handle: Handle): Promise<void> {
    clearTimeout(handle.timer);
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(handle.host.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await once(killer, 'close');
    } else {
      for (const pid of new Set([handle.state.pid, handle.host.pid!])) { try { process.kill(-pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
    }
    let timeout: NodeJS.Timeout | undefined;
    try { await Promise.race([handle.exited, new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new UnknownOutcome('Terminal exit could not be confirmed. Inspect its PID.')), 5000); })]); }
    finally { clearTimeout(timeout); }
  }
  resolve(store: Store, session: Session, id: string, note: string): void {
    const state = this.list(store, session).find(state => state.id === id);
    if (!state || state.status !== 'unknown' || !note.trim()) throw new Error('Inspect an unknown terminal and supply its verified outcome.');
    store.event(session.id, 'terminal', { ...state, status: 'closed', note: this.secrets.redact(note) });
  }
  async close(): Promise<void> { await Promise.all([...this.handles.values()].map(handle => this.stop(handle.owner, handle.state.id))); this.handles.clear(); }
}
