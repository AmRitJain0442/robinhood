import type { CompatibleSpec } from '../compatible.js';

export function cloudflare(account: string): CompatibleSpec {
  if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error('Cloudflare needs a 32-character account ID. Set CLOUDFLARE_ACCOUNT_ID or enter it at /connect.');
  return {
    id: 'cloudflare', name: 'Cloudflare Workers AI',
    baseURL: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`,
    modelsPath: null,
    models: [{ id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', context: 24000 }],
    notice: 'The neuron allowance is account-wide; paid-tier eligibility and excess usage cannot be verified here.',
  };
}
