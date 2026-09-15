import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Message, Operation, Session, Usage } from './types.js';

export class Store {
  private readonly db: Database.Database;
  private readonly owner = randomUUID();
  private closed = false;

  constructor(filename: string) {
    mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new Database(filename);
    try {
      if (Number(this.db.pragma('user_version', { simple: true })) > 1) throw new Error('This database needs a newer Robinhood version.');
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = FULL');
      this.db.pragma('foreign_keys = ON');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, pid INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY, workspace TEXT NOT NULL, identity TEXT NOT NULL,
          objective TEXT NOT NULL, route TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          body TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS operations (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          call_id TEXT NOT NULL, name TEXT NOT NULL, args TEXT NOT NULL, state TEXT NOT NULL, result TEXT
        );
        CREATE TABLE IF NOT EXISTS events (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          kind TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS operation_call ON operations(session_id, call_id);
        PRAGMA user_version = 1;
      `);
      // Serialize ownership acquisition with SQLite, including recovery from a dead process.
      this.db.transaction(() => {
        const previous = this.db.prepare('SELECT * FROM owner WHERE id=1').get() as { pid: number } | undefined;
        if (previous) {
          let alive = true;
          try { process.kill(previous.pid, 0); } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
          }
          if (alive) throw new Error(`Robinhood data is already open in process ${previous.pid}. Close that process first.`);
        }
        this.db.prepare('INSERT OR REPLACE INTO owner VALUES (1, ?, ?)').run(this.owner, process.pid);
        this.db.prepare("UPDATE operations SET state='unknown' WHERE state='running'").run();
        const prepared = this.db.prepare("SELECT * FROM operations WHERE state='prepared'").all() as Operation[];
        for (const op of prepared) this.finish(op.id, 'failed', 'Interrupted before execution. No action was launched.');
      }).immediate();
      if (process.platform !== 'win32') chmodSync(filename, 0o600);
    } catch (error) { this.db.close(); throw error; }
  }

  create(workspace: string, identity: string, objective: string): Session {
    const session: Session = { id: randomUUID(), workspace, identity, objective, route: null, created_at: new Date().toISOString() };
    this.db.prepare('INSERT INTO sessions VALUES (@id, @workspace, @identity, @objective, @route, @created_at)').run(session);
    return session;
  }

  get(id: string): Session {
    const rows = this.db.prepare('SELECT * FROM sessions WHERE id LIKE ?').all(`${id}%`) as Session[];
    if (rows.length !== 1) throw new Error(rows.length ? 'Session prefix is ambiguous.' : 'Session not found.');
    return rows[0]!;
  }

  list(): Session[] { return this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all() as Session[]; }

  messages(id: string): Message[] {
    return (this.db.prepare('SELECT body FROM messages WHERE session_id=? ORDER BY seq').all(id) as { body: string }[]).map(row => JSON.parse(row.body) as Message);
  }

  append(id: string, message: Message): void {
    this.db.prepare('INSERT INTO messages (session_id, body) VALUES (?, ?)').run(id, JSON.stringify(message));
  }

  event(id: string, kind: string, body: unknown): void {
    this.db.prepare('INSERT INTO events (session_id, kind, body, created_at) VALUES (?, ?, ?, ?)').run(id, kind, JSON.stringify(body), new Date().toISOString());
  }

  events(id: string): { kind: string; body: unknown; created_at: string }[] {
    return (this.db.prepare('SELECT kind, body, created_at FROM events WHERE session_id=? ORDER BY seq').all(id) as { kind: string; body: string; created_at: string }[]).map(row => ({ ...row, body: JSON.parse(row.body) as unknown }));
  }

  selectRoute(id: string, route: string): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE sessions SET route=? WHERE id=?').run(route, id);
      this.event(id, 'route', { route });
    })();
  }

  prepare(id: string, message: Message, usage?: Usage): Operation[] {
    return this.db.transaction(() => {
      const seen = new Set<string>();
      for (const call of message.tool_calls ?? []) {
        if (seen.has(call.id) || this.db.prepare('SELECT 1 FROM operations WHERE session_id=? AND call_id=?').get(id, call.id)) throw new Error('Provider reused a tool-call ID. Paused without executing it again.');
        seen.add(call.id);
      }
      this.append(id, message);
      if (usage) this.event(id, 'usage', usage);
      const operations = (message.tool_calls ?? []).map(call => ({
        id: randomUUID(), session_id: id, call_id: call.id, name: call.function.name,
        args: call.function.arguments, state: 'prepared' as const, result: null,
      }));
      const insert = this.db.prepare('INSERT INTO operations VALUES (@id, @session_id, @call_id, @name, @args, @state, @result)');
      for (const operation of operations) insert.run(operation);
      return operations;
    })();
  }

  running(id: string): void {
    const result = this.db.prepare("UPDATE operations SET state='running' WHERE id=? AND state='prepared'").run(id);
    if (result.changes !== 1) throw new Error('Operation is not ready to execute.');
  }

  finish(id: string, state: 'completed' | 'failed', result: string): void {
    this.db.transaction(() => {
      const op = this.db.prepare('SELECT * FROM operations WHERE id=?').get(id) as Operation | undefined;
      if (!op || op.state === 'completed' || op.state === 'failed') throw new Error('Operation already settled or missing.');
      this.db.prepare('UPDATE operations SET state=?, result=? WHERE id=?').run(state, result, id);
      this.append(op.session_id, { role: 'tool', tool_call_id: op.call_id, content: result });
    })();
  }

  uncertain(id: string, explanation: string): void {
    this.db.prepare("UPDATE operations SET state='unknown', result=? WHERE id=?").run(explanation, id);
  }

  operations(id: string): Operation[] {
    return this.db.prepare('SELECT * FROM operations WHERE session_id=? ORDER BY rowid').all(id) as Operation[];
  }

  delete(id: string): void {
    if (this.operations(id).some(op => op.state === 'unknown' || op.state === 'running')) throw new Error('Resolve uncertain operations before deleting this session.');
    this.db.prepare('DELETE FROM sessions WHERE id=?').run(id);
  }

  reconcileWorkspace(id: string, identity: string): Session {
    if (this.operations(id).some(op => op.state === 'unknown' || op.state === 'running')) throw new Error('Resolve uncertain operations before reconciling the workspace.');
    this.db.transaction(() => {
      this.db.prepare('UPDATE sessions SET identity=? WHERE id=?').run(identity, id);
      this.event(id, 'workspace-reconciled', { identity });
      this.append(id, { role: 'user', content: 'I reviewed and accepted the changed workspace identity or Git HEAD. Re-read relevant files before making further edits; earlier tool receipts describe the previous workspace state.' });
    })();
    return this.get(id);
  }

  close(): void {
    if (this.closed) return;
    this.db.prepare('DELETE FROM owner WHERE token=?').run(this.owner);
    this.db.close();
    this.closed = true;
  }
}
