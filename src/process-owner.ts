import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

type Identity = { name: string; started: string };

// A PID alone is not an identity: Windows (and Unix) reuse process IDs.
function inspect(pid: number): Identity | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  try {
    if (process.platform === 'win32') {
      const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction Stop; if ($p) { @{ name = $p.Name; started = $p.CreationDate.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json -Compress }`],
      { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      const value = JSON.parse(output) as Identity;
      if (typeof value.name === 'string' && typeof value.started === 'string' && value.started) return value;
    } else if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const end = stat.lastIndexOf(')');
      const started = stat.slice(end + 2).split(' ')[19];
      if (started) return { name: stat.slice(stat.indexOf('(') + 1, end), started: `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${started}` };
    } else {
      const started = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 5000 }).trim();
      if (started) return { name: '', started };
    }
  } catch { /* An unavailable identity must not unlock a potentially live owner. */ }
  return undefined;
}

let self: Identity | undefined;
export function ownerToken(uuid: string): string {
  self ??= inspect(process.pid);
  return self ? `${uuid}|${self.started}` : uuid;
}

export function ownerIsAlive(owner: { pid: number; token: string }): boolean {
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return true;
  try { process.kill(owner.pid, 0); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
  }
  const identity = owner.pid === process.pid ? (self ??= inspect(process.pid)) : inspect(owner.pid);
  if (!identity) return true;
  const separator = owner.token.indexOf('|');
  if (separator !== -1) return owner.token.slice(separator + 1) === identity.started;
  // Older Windows releases stored only a PID. A non-Node executable cannot
  // own this Node-only application; an ambiguous Node owner stays locked.
  if (process.platform === 'win32') return identity.name.toLowerCase() === path.basename(process.execPath).toLowerCase();
  return true;
}
