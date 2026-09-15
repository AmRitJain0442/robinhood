import { object } from '../chat-completions.js';
import type { CompatibleSpec } from '../compatible.js';

export const vercel: CompatibleSpec = {
  id: 'vercel', name: 'Vercel AI Gateway', baseURL: 'https://ai-gateway.vercel.sh/v1', models: [],
  notice: 'The gateway may choose an upstream provider. Monthly credits and eligible models are account-dependent.',
  discoverModels: data => data.flatMap(value => {
    const model = object(value);
    if (model.type !== 'language' || !Array.isArray(model.supported_parameters) || !model.supported_parameters.includes('tools')) return [];
    if (typeof model.id !== 'string' || typeof model.context_window !== 'number' || !Number.isSafeInteger(model.context_window) || model.context_window < 8192) return [];
    return [{ id: model.id, context: model.context_window }];
  }),
};
