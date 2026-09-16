import { homedir } from 'node:os';
import path from 'node:path';

export function dataPath(): string {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local'), 'Robinhood');
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support', 'Robinhood');
  return path.join(process.env.XDG_DATA_HOME ?? path.join(homedir(), '.local', 'share'), 'robinhood');
}
