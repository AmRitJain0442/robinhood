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
