import { spawn } from 'node:child_process';
import { once } from 'node:events';

export interface HeadlessRequest { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; input: string }

export function minimalEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'PATHEXT', 'LANG', 'LC_ALL']) if (process.env[name]) env[name] = process.env[name];
  return env;
}

// Prompts go through stdin, never shell interpolation or process arguments.
export async function runHeadless(request: HeadlessRequest, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const child = spawn(request.command, request.args, { cwd: request.cwd, env: request.env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', size = 0, failure: Error | undefined;
  let stopping: Promise<void> | undefined;
  const stop = (error: Error) => {
    failure ??= error;
    if (!stopping) stopping = (async () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        await once(killer, 'close');
      } else { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
    })();
    void stopping.catch(() => {});
  };
  const abort = () => stop(new Error('CLI request cancelled or timed out.'));
  signal.addEventListener('abort', abort, { once: true });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { size += Buffer.byteLength(chunk); if (size > 1024 * 1024) stop(new Error('CLI response exceeded 1 MiB.')); else output += chunk; });
  // Diagnostics can contain credentials or project text. Only return bounded JSON stdout.
  child.stderr.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 1024 * 1024) stop(new Error('CLI diagnostics exceeded 1 MiB.')); });
  child.stdin.on('error', () => {});
  const exited = once(child, 'close');
  child.stdin.end(request.input);
  try {
    const [code] = await exited;
    if (stopping) await stopping;
    if (failure) throw failure;
    if (code !== 0) throw new Error(`CLI request failed (exit ${String(code)}). Sign in with its native login command, check account access, or try another model.`);
    return output;
  } finally { signal.removeEventListener('abort', abort); }
}
