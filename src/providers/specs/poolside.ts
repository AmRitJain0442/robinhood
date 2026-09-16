import type { CompatibleSpec } from '../compatible.js';

export const poolside: CompatibleSpec = {
  "id": "poolside",
  "name": "Poolside",
  "baseURL": "https://inference.poolside.ai/v1",
  "models": [
    {
      "id": "poolside/laguna-s-2.1",
      "context": 64000
    }
  ]
};
