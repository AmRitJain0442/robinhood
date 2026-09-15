import type { CompatibleSpec } from '../compatible.js';

export const cline: CompatibleSpec = {
  "id": "cline",
  "name": "Cline API",
  "baseURL": "https://api.cline.bot/api/v1",
  "models": [
    {
      "id": "minimax/minimax-m2.5",
      "context": 64000
    }
  ],
  "notice": "Promotional models can have provider-specific data-use terms; review the current offer before sharing private work."
};
