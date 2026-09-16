// Official setup guides. Adding an API connector does not imply portable browser OAuth.
export const setupGuides: Record<string, string> = {
  openrouter: 'https://openrouter.ai/settings/keys',
  puter: 'https://docs.puter.com/getting-started/',
  horde: 'https://aihorde.net/',
  kilo: 'https://kilo.ai/docs/gateway/authentication',
  gemini: 'https://ai.google.dev/gemini-api/docs/api-key',
  groq: 'https://console.groq.com/keys',
  mistral: 'https://docs.mistral.ai/getting-started/quickstart',
  inception: 'https://docs.inceptionlabs.ai/get-started/models',
  cerebras: 'https://inference-docs.cerebras.ai/quickstart',
  sambanova: 'https://docs.sambanova.ai/',
  zai: 'https://docs.z.ai/guides/overview/quick-start',
  zen: 'https://opencode.ai/docs/zen/',
  cline: 'https://docs.cline.bot/api/chat-completions',
  vercel: 'https://vercel.com/docs/ai-gateway',
  huggingface: 'https://huggingface.co/settings/tokens',
  nvidia: 'https://build.nvidia.com/',
  fireworks: 'https://docs.fireworks.ai/getting-started/quickstart',
  scaleway: 'https://www.scaleway.com/en/docs/generative-apis/',
  sarvam: 'https://docs.sarvam.ai/api-reference/authentication',
  poolside: 'https://docs.poolside.ai/api/overview',
  alibaba: 'https://www.alibabacloud.com/help/en/model-studio/',
  ollama: 'https://docs.ollama.com/cloud',
  cohere: 'https://dashboard.cohere.com/api-keys',
  cloudflare: 'https://developers.cloudflare.com/workers-ai/get-started/rest-api/',
  ai21: 'https://docs.ai21.com/',
};

export function accountPriority(id: string): number {
  const index = ['openrouter', 'kilo', 'puter', 'gemini', 'horde'].indexOf(id);
  return index === -1 ? 100 : index;
}
