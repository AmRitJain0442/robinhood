import { ai21 } from './specs/ai21.js';
import { OpenCodeBridge } from '../bridges/opencode.js';
import { KiloBridge } from '../bridges/kilo.js';
import { GeminiCliBridge } from '../bridges/gemini-cli.js';
import { Horde } from './horde.js';
import { Puter } from './puter.js';
import { cohere } from './specs/cohere.js';
import { cloudflare } from './specs/cloudflare.js';
import { ollama } from './specs/ollama.js';
import { alibaba } from './specs/alibaba.js';
import { poolside } from './specs/poolside.js';
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
  bridge?: { label: string; login?: string };
  configuration?: { env: string; prompt: string };
  create(key: string, configuration?: string): Connector;
}
export const providers: ProviderDefinition[] = [
  { id: 'gemini-cli', name: 'Gemini CLI (Google login)', env: 'ROBINHOOD_GEMINI_CLI', bridge: { label: 'Use Gemini CLI Google profile', login: 'First run: robinhood login gemini-cli' }, access: 'Native Google login; account-dependent free allowance; confirmation each request', create: () => new GeminiCliBridge() },
  { id: 'opencode', name: 'OpenCode CLI bridge', env: 'ROBINHOOD_OPENCODE', anonymous: true, bridge: { label: 'Launch OpenCode free-model bridge' }, access: 'Isolated local OpenCode engine; advertised free models; public-data confirmation; internal retries possible', create: () => new OpenCodeBridge() },
  { id: 'kilo-cli', name: 'Kilo CLI bridge', env: 'ROBINHOOD_KILO_CLI', anonymous: true, bridge: { label: 'Launch Kilo free-model bridge' }, access: 'Isolated Kilo engine; explicit zero-priced free models; public-data confirmation; internal retries possible', create: () => new KiloBridge() },
  { id: 'puter', name: 'Puter user auth token', env: 'PUTER_AUTH_TOKEN', access: 'Experimental driver protocol; account-dependent; confirmation each request', create: key => new Puter(key) },
  { id: 'horde', name: 'AI Horde (blank key for anonymous access)', env: 'AI_HORDE_API_KEY', anonymous: true, access: 'Public text only; queued volunteer service; no coding tools', create: key => new Horde(key) },
  { id: 'ai21', name: 'AI21', env: 'AI21_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(ai21, key) },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', env: 'CLOUDFLARE_API_TOKEN', configuration: { env: 'CLOUDFLARE_ACCOUNT_ID', prompt: 'Cloudflare account ID' }, access: 'Account-dependent; each request needs confirmation', create: (key, account) => new Compatible(cloudflare(account ?? ''), key) },
  { id: 'cohere', name: 'Cohere', env: 'COHERE_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(cohere, key) },
  { id: 'ollama', name: 'Ollama Cloud', env: 'OLLAMA_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(ollama, key) },
  { id: 'alibaba', name: 'Alibaba Model Studio', env: 'DASHSCOPE_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(alibaba, key) },
  { id: 'poolside', name: 'Poolside', env: 'POOLSIDE_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Compatible(poolside, key) },
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
