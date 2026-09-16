import { execFileSync } from 'node:child_process';
import { unlink } from 'node:fs/promises';

/** Include new and deleted files without modifying the agent's real Git index. */
export async function benchmarkPatch(workspace: string, base: string, indexFile: string): Promise<string> {
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('Expected a pinned Git commit.');
  const git = (...args: string[]) => execFileSync('git', ['-C', workspace, ...args], { env: { ...process.env, GIT_INDEX_FILE: indexFile }, encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
  try {
    git('read-tree', base);
    git('add', '-A', '--', '.');
    return git('diff', '--cached', '--binary', '--full-index', base, '--');
  } finally { await unlink(indexFile).catch(() => {}); }
}
