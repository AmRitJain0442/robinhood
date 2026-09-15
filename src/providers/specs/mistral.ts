import { object } from '../chat-completions.js';
import type { CompatibleSpec } from '../compatible.js';

export const mistral: CompatibleSpec = {
  id: 'mistral', name: 'Mistral', baseURL: 'https://api.mistral.ai/v1', models: [],
  discoverModels: data => data.flatMap(value => {
    const model = object(value), capabilities = object(model.capabilities);
    if (model.archived === true || capabilities.completion_chat !== true || capabilities.function_calling !== true) return [];
    if (typeof model.id !== 'string' || typeof model.max_context_length !== 'number' || !Number.isSafeInteger(model.max_context_length) || model.max_context_length < 8192) return [];
    return [{ id: model.id, context: model.max_context_length }];
  }),
};
