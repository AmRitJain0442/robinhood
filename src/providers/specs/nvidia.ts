import type { CompatibleSpec } from '../compatible.js';

export const nvidia: CompatibleSpec = {
  "id": "nvidia",
  "name": "NVIDIA API Catalog",
  "baseURL": "https://integrate.api.nvidia.com/v1",
  "models": [
    {
      "id": "meta/llama-3.3-70b-instruct",
      "context": 128000
    }
  ],
  "notice": "Hosted evaluation is trial-only. Do not send personal or confidential data; review NVIDIA API trial terms."
};
