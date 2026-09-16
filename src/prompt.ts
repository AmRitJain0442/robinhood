import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const systemPrompt = readFileSync(new URL('../../prompts/system.md', import.meta.url), 'utf8').trim();
if (!systemPrompt || Buffer.byteLength(systemPrompt) > 32000) throw new Error('The bundled system prompt must contain 1-32000 bytes. See prompts/README.md.');
export const systemPromptHash = createHash('sha256').update(systemPrompt).digest('hex');
const compactPrompt = readFileSync(new URL('../../prompts/compact.md', import.meta.url), 'utf8').trim();
export function promptForProvider(provider: string): { text: string; hash: string } {
  const text = provider === 'horde' ? compactPrompt : systemPrompt;
  return { text, hash: createHash('sha256').update(text).digest('hex') };
}
