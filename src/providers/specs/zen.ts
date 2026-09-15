import type { CompatibleSpec } from '../compatible.js';

export const zen: CompatibleSpec = {
  "id": "zen",
  "name": "OpenCode Zen",
  "baseURL": "https://opencode.ai/zen/v1",
  "models": [
    {
      "id": "big-pickle",
      "context": 64000
    },
    {
      "id": "mimo-v2.5-free",
      "context": 64000
    },
    {
      "id": "ling-3.0-flash-fin-free",
      "context": 64000
    },
    {
      "id": "nemotron-3-ultra-free",
      "context": 64000
    },
    {
      "id": "nemotron-3.5-lightning-free",
      "context": 64000
    }
  ],
  "notice": "Promotional endpoints can retain prompts for improvement. Use public, non-confidential data only; NVIDIA models are trial-only."
};
