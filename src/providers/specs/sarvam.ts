import type { CompatibleSpec } from '../compatible.js';

export const sarvam: CompatibleSpec = {
  "id": "sarvam",
  "name": "Sarvam AI",
  "baseURL": "https://api.sarvam.ai/v1",
  "keyHeader": "api-subscription-key",
  "modelsPath": null,
  "models": [
    {
      "id": "sarvam-105b",
      "context": 128000
    },
    {
      "id": "sarvam-105b-conversations",
      "context": 32000
    }
  ],
  "extraBody": {
    "reasoning_effort": null
  }
};
