import type { CompatibleSpec } from '../compatible.js';

// https://console.groq.com/docs/api-reference — checked 2026-09-15.
export const groq: CompatibleSpec = {
  id: 'groq', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', maxTokenField: 'max_completion_tokens',
  models: [
    { id: 'openai/gpt-oss-120b', context: 131072 },
    { id: 'openai/gpt-oss-20b', context: 131072 },
    { id: 'qwen/qwen3.8-27b', context: 131072 },
    { id: 'llama-3.3-70b-versatile', context: 131072 },
  ],
};
