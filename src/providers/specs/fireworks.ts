import type { CompatibleSpec } from '../compatible.js';

export const fireworks: CompatibleSpec = {
  "id": "fireworks",
  "name": "Fireworks AI",
  "baseURL": "https://api.fireworks.ai/inference/v1",
  "modelsPath": null,
  "models": [
    {
      "id": "accounts/fireworks/models/gpt-oss-120b",
      "context": 131000
    }
  ]
};
