import { object } from '../chat-completions.js';
import type { CompatibleSpec } from '../compatible.js';

export const huggingface: CompatibleSpec = {
  id: 'huggingface', name: 'Hugging Face', baseURL: 'https://router.huggingface.co/v1', models: [],
  discoverModels: data => data.flatMap(value => {
    const model = object(value);
    if (typeof model.id !== 'string' || !Array.isArray(model.providers)) return [];
    return model.providers.flatMap(value => {
      const provider = object(value);
      if (provider.status !== 'live' || provider.supports_tools !== true || typeof provider.provider !== 'string') return [];
      if (typeof provider.context_length !== 'number' || !Number.isSafeInteger(provider.context_length) || provider.context_length < 8192) return [];
      return [{ id: `${model.id}:${provider.provider}`, context: provider.context_length }];
    });
  }),
};
