// One native PTY per disposable host keeps native handles out of the main TUI.
import * as native from 'node-pty';
const terminal = native.spawn(process.platform === 'win32' ? 'powershell.exe' : '/bin/bash', process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : ['--noprofile', '--norc'], { cwd: process.cwd(), env: process.env as Record<string, string>, cols: 100, rows: 30, name: 'xterm-256color' });
process.send?.({ type: 'ready', pid: terminal.pid });
terminal.onData(data => { process.send?.({ type: 'data', data }); });
terminal.onExit(({ exitCode }) => { process.send?.({ type: 'exit', exitCode }, () => process.exit(0)); });
process.on('message', (message: { type?: string; text?: string }) => {
  if (message.type === 'input' && typeof message.text === 'string' && message.text.length <= 4000) terminal.write(message.text);
});
process.on('disconnect', () => { try { terminal.kill(); } finally { process.exit(1); } });
