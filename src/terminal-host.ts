// One native PTY per disposable host keeps native handles out of the main TUI.
import * as native from 'node-pty';
import { createRequire } from 'node:module';
import { chmodSync, existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
// node-pty 1.1.0 ships Darwin spawn-helper without its execute bit (upstream #850).
if (process.platform === 'darwin') {
  const root = realpathSync(path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json')));
  for (const relative of ['build/Release/spawn-helper', `prebuilds/darwin-${process.arch}/spawn-helper`]) {
    const candidate = path.join(root, relative);
    if (!existsSync(candidate)) continue;
    const helper = realpathSync(candidate);
    if (!helper.startsWith(root + path.sep)) throw new Error('PTY helper escaped its installed package.');
    const mode = statSync(helper).mode;
    if (!(mode & 0o100)) chmodSync(helper, mode | 0o111);
  }
}
const terminal = native.spawn(process.platform === 'win32' ? 'powershell.exe' : '/bin/bash', process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : ['--noprofile', '--norc'], { cwd: process.cwd(), env: process.env as Record<string, string>, cols: 100, rows: 30, name: 'xterm-256color' });
process.send?.({ type: 'ready', pid: terminal.pid });
terminal.onData(data => { process.send?.({ type: 'data', data }); });
terminal.onExit(({ exitCode }) => { process.send?.({ type: 'exit', exitCode }, () => process.exit(0)); });
process.on('message', (message: { type?: string; text?: string }) => {
  if (message.type === 'input' && typeof message.text === 'string' && message.text.length <= 4000) terminal.write(message.text);
});
process.on('disconnect', () => { try { terminal.kill(); } finally { process.exit(1); } });
