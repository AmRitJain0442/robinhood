import type { CompatibleSpec } from '../compatible.js';

export const alibaba: CompatibleSpec = {
  "id": "alibaba",
  "name": "Alibaba Model Studio",
  "baseURL": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  "modelsPath": null,
  "models": [
    {
      "id": "qwen-plus",
      "context": 64000
    },
    {
      "id": "qwen-turbo",
      "context": 64000
    },
    {
      "id": "qwen3-coder-plus",
      "context": 64000
    }
  ]
};
