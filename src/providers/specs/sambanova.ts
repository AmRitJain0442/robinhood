import type { CompatibleSpec } from '../compatible.js';

export const sambanova: CompatibleSpec = {
  "id": "sambanova",
  "name": "SambaNova",
  "baseURL": "https://api.sambanova.ai/v1",
  "models": [
    {
      "id": "Meta-Llama-3.3-70B-Instruct",
      "context": 128000
    },
    {
      "id": "gpt-oss-120b",
      "context": 128000
    },
    {
      "id": "DeepSeek-V3.1",
      "context": 128000
    }
  ],
  "extraBody": {
    "stream_options": {
      "include_usage": true
    }
  }
};
