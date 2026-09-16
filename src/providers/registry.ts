import { sarvam } from './specs/sarvam.js';
import { scaleway } from './specs/scaleway.js';
import { fireworks } from './specs/fireworks.js';
import { nvidia } from './specs/nvidia.js';
import { cline } from './specs/cline.js';
import { vercel } from './specs/vercel.js';
import { huggingface } from './specs/huggingface.js';
import { zen } from './specs/zen.js';
import { zai } from './specs/zai.js';
import { sambanova } from './specs/sambanova.js';
import { cerebras } from './specs/cerebras.js';
import { inception } from './specs/inception.js';
import type { Connector } from '../types.js';
import { OpenRouter } from './openrouter.js';
import { Gemini } from './gemini.js';
import { Compatible } from './compatible.js';
import { groq } from './specs/groq.js';
import { mistral } from './specs/mistral.js';
import { Kilo } from './kilo.js';

export interface ProviderDefinition {
  id: string;
  name: string;
  env: string;
  access: string;
  anonymous?: boolean;
  create(key: string): Connector;
}
export const providers: ProviderDefinition[] = [
  { id: 'sarvam', name: 'Sarvam AI', env: 'SARVAM_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(sarvam, key) },
  { id: 'scaleway', name: 'Scaleway', env: 'SCALEWAY_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(scaleway, key) },
  { id: 'fireworks', name: 'Fireworks AI', env: 'FIREWORKS_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(fireworks, key) },
  { id: 'nvidia', name: 'NVIDIA API Catalog', env: 'NVIDIA_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(nvidia, key) },
  { id: 'huggingface', name: 'Hugging Face', env: 'HF_TOKEN', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(huggingface, key) },
  { id: 'vercel', name: 'Vercel AI Gateway', env: 'AI_GATEWAY_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(vercel, key) },
  { id: 'cline', name: 'Cline API', env: 'CLINE_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(cline, key) },
  { id: 'zen', name: 'OpenCode Zen', env: 'OPENCODE_ZEN_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(zen, key) },
  { id: 'zai', name: 'Z.ai', env: 'ZAI_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(zai, key) },
  { id: 'sambanova', name: 'SambaNova', env: 'SAMBANOVA_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(sambanova, key) },
  { id: 'cerebras', name: 'Cerebras', env: 'CEREBRAS_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(cerebras, key) },
  { id: 'inception', name: 'Inception', env: 'INCEPTION_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(inception, key) },
  { id: 'kilo', name: 'Kilo (blank key for anonymous access)', env: 'KILO_API_KEY', anonymous: true, access: 'Verified zero-priced routes; public-data confirmation', create: key => new Kilo(key) },
  { id: 'openrouter', name: 'OpenRouter', env: 'OPENROUTER_API_KEY', access: 'Verified zero-priced model routes', create: key => new OpenRouter(key) },
  { id: 'gemini', name: 'Gemini', env: 'GEMINI_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Gemini(key) },
  { id: 'groq', name: 'Groq', env: 'GROQ_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(groq, key) },
  { id: 'mistral', name: 'Mistral', env: 'MISTRAL_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(mistral, key) },
];
export function providerDefinition(id: string): ProviderDefinition {
  const entry = providers.find(provider => provider.id === id);
  if (!entry) throw new Error(`Unknown provider. Available: ${providers.map(provider => provider.id).join(', ')}`);
  return entry;
}
