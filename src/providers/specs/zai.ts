import type { CompatibleSpec } from '../compatible.js';

export const zai: CompatibleSpec = {
  "id": "zai",
  "name": "Z.ai",
  "baseURL": "https://api.z.ai/api/paas/v4",
  "modelsPath": null,
  "models": [
    {
      "id": "glm-4.7-flash",
      "context": 200000
    },
    {
      "id": "glm-4.5-flash",
      "context": 128000
    }
  ],
  "extraBody": {
    "thinking": {
      "type": "disabled"
    }
  }
};
