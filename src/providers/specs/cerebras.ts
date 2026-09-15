import type { CompatibleSpec } from '../compatible.js';

export const cerebras: CompatibleSpec = {
  "id": "cerebras",
  "name": "Cerebras",
  "baseURL": "https://api.cerebras.ai/v1",
  "maxTokenField": "max_completion_tokens",
  "models": [
    {
      "id": "gpt-oss-120b",
      "context": 65000
    },
    {
      "id": "qwen-3.8-27b",
      "context": 64000
    }
  ]
};
