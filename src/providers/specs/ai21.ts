import type { CompatibleSpec } from '../compatible.js';

export const ai21: CompatibleSpec = {
  "id": "ai21",
  "name": "AI21",
  "baseURL": "https://api.ai21.com/studio/v1",
  "modelsPath": null,
  "nonStreaming": true,
  "omitToolChoice": true,
  "models": [
    {
      "id": "jamba-large",
      "context": 64000
    },
    {
      "id": "jamba-mini",
      "context": 64000
    }
  ]
};
