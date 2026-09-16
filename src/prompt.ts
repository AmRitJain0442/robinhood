import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const systemPrompt = readFileSync(new URL('../../prompts/system.md', import.meta.url), 'utf8').trim();
if (!systemPrompt || Buffer.byteLength(systemPrompt) > 32000) throw new Error('The bundled system prompt must contain 1-32000 bytes. See prompts/README.md.');
export const systemPromptHash = createHash('sha256').update(systemPrompt).digest('hex');
