import type { CompatibleSpec } from '../compatible.js';

export const scaleway: CompatibleSpec = {
  "id": "scaleway",
  "name": "Scaleway",
  "baseURL": "https://api.scaleway.ai/v1",
  "models": [
    {
      "id": "gemma-4-26b-a4b-it",
      "context": 64000
    }
  ]
};
