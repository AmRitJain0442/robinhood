import type { CompatibleSpec } from '../compatible.js';

export const inception: CompatibleSpec = {
  "id": "inception",
  "name": "Inception",
  "baseURL": "https://api.inceptionlabs.ai/v1",
  "maxTokenField": "max_completion_tokens",
  "models": [
    {
      "id": "mercury-2.5",
      "context": 260000
    },
    {
      "id": "mercury-2",
      "context": 128000
    }
  ]
};
