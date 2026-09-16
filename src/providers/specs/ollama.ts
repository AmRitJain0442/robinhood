import type { CompatibleSpec } from '../compatible.js';

export const ollama: CompatibleSpec = {
  "id": "ollama",
  "name": "Ollama Cloud",
  "baseURL": "https://ollama.com/v1",
  "models": [
    {
      "id": "gemma4:31b",
      "context": 64000
    },
    {
      "id": "gpt-oss:120b",
      "context": 64000
    }
  ]
};
