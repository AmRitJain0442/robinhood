import type { Connector } from '../types.js';
import { OpenRouter } from './openrouter.js';
import { Gemini } from './gemini.js';

export interface ProviderDefinition {
  id: string;
  name: string;
  env: string;
  access: string;
  create(key: string): Connector;
}
export const providers: ProviderDefinition[] = [
  { id: 'openrouter', name: 'OpenRouter', env: 'OPENROUTER_API_KEY', access: 'Verified zero-priced model routes', create: key => new OpenRouter(key) },
  { id: 'gemini', name: 'Gemini', env: 'GEMINI_API_KEY', access: 'Account-dependent; each request needs confirmation', create: key => new Gemini(key) },
];
export function providerDefinition(id: string): ProviderDefinition {
  const entry = providers.find(provider => provider.id === id);
  if (!entry) throw new Error(`Unknown provider. Available: ${providers.map(provider => provider.id).join(', ')}`);
  return entry;
}
