import type { CompatibleSpec } from '../compatible.js';

export const cohere: CompatibleSpec = {
  "id": "cohere",
  "name": "Cohere",
  "baseURL": "https://api.cohere.ai/compatibility/v1",
  "modelsPath": null,
  "omitToolChoice": true,
  "models": [
    {
      "id": "command-a-plus-05-2026",
      "context": 64000
    }
  ],
  "extraBody": {
    "reasoning_effort": "none"
  }
};
