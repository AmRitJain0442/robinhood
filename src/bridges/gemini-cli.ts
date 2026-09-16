import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { dataPath } from '../paths.js';
import { RouteError, type Connector, type ModelInfo, type Route } from '../types.js';
import { engineCompletion, outputSchema } from './opencode.js';
import { toolDefinitions } from '../tools.js';
import { chatMessages } from '../providers/memory.js';
import { object } from '../providers/chat-completions.js';
import { contextBudget, manualConsent } from '../providers/http.js';
import { minimalEnvironment, runHeadless, type HeadlessRequest } from './headless-process.js';

export const GEMINI_CLI_VERSION = '0.60.0';
export const geminiProfile = () => path.join(dataPath(), 'cli-profiles', 'gemini');
export const denyTools = '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n';
export const geminiCLIModels: ModelInfo[] = [
  { id: 'gemini-2.5-flash', context: 64000 }, { id: 'gemini-2.5-pro', context: 64000 },
  { id: 'gemini-3-flash-preview', context: 64000 }, { id: 'gemini-3.1-pro-preview', context: 64000 },
];

export async function prepareGemini(profile: string, fixture?: { baseURL: string; apiKey: string }): Promise<Omit<HeadlessRequest, 'input'>> {
  const require = createRequire(import.meta.url);
  let file: string;
  try { file = require.resolve('@google/gemini-cli/package.json'); }
  catch { throw new Error('Gemini CLI is missing. Run npm install --include=optional in the Robinhood checkout.'); }
  const pkg = JSON.parse(await readFile(file, 'utf8')) as { version: string; bin: { gemini: string } };
  if (pkg.version !== GEMINI_CLI_VERSION) throw new Error(`This bridge requires Gemini CLI ${GEMINI_CLI_VERSION}. Run npm ci.`);
  const cwd = path.join(profile, 'workspace');
  const config = path.join(profile, '.gemini');
  await mkdir(cwd, { recursive: true, mode: 0o700 }); await mkdir(config, { recursive: true, mode: 0o700 });
  const settings = path.join(config, 'settings.json');
  const policy = path.join(profile, 'deny-tools.toml');
  const authType = fixture ? 'gemini-api-key' : 'oauth-personal';
  if (fixture && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(fixture.baseURL).hostname)) throw new Error('Fixture transport must be loopback.');
  await writeFile(settings, JSON.stringify({
    security: { auth: { selectedType: authType, enforcedType: authType }, folderTrust: { enabled: false } },
    general: { maxAttempts: 1, retryFetchErrors: false, enableAutoUpdate: false },
    model: { maxSessionTurns: 2 }, tools: { core: [] }, mcpServers: {},
    hooksConfig: { enabled: false }, skills: { enabled: false }, telemetry: { enabled: false },
    experimental: { enableAgents: false }, advanced: { autoConfigureMemory: false },
  }), { mode: 0o600 });
  await writeFile(policy, denyTools, { mode: 0o600 });
  const env = {
    ...minimalEnvironment(), HOME: profile, USERPROFILE: profile, GEMINI_CLI_HOME: profile,
    GEMINI_CLI_NO_RELAUNCH: 'true', GEMINI_CLI_SURFACE: 'robinhood',
    ...(fixture ? { GOOGLE_GEMINI_BASE_URL: fixture.baseURL, GEMINI_API_KEY: fixture.apiKey } : {}),
  };
  return { command: process.execPath, args: [path.resolve(path.dirname(file), pkg.bin.gemini), '--policy', policy, '--extensions', 'none'], cwd, env };
}

export async function loginGemini(profile = geminiProfile()): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Gemini Google sign-in needs an interactive terminal. Run robinhood login gemini-cli.');
  const request = await prepareGemini(profile);
  console.log('Sign in with Google in Gemini CLI, then use /quit to return. Robinhood keeps this login in its dedicated Gemini profile.');
  const child = spawn(request.command, request.args, { cwd: request.cwd, env: request.env, stdio: 'inherit', windowsHide: true });
  const [code] = await once(child, 'close');
  if (code !== 0) throw new Error('Gemini sign-in exited without confirmation. Retry robinhood login gemini-cli.');
  console.log('Gemini CLI closed. Run robinhood, then /connect gemini-cli and /models gemini-cli.');
}

export interface GeminiRunner { run(model: string, prompt: string, signal: AbortSignal): Promise<string> }
export class GeminiProcess implements GeminiRunner {
  constructor(private readonly profile = geminiProfile(), private readonly fixture?: { baseURL: string; apiKey: string }) {}
  async run(model: string, prompt: string, signal: AbortSignal): Promise<string> {
    const request = await prepareGemini(this.profile, this.fixture);
    return runHeadless({ ...request, args: [...request.args, '--model', model, '--output-format', 'json', '--prompt', 'Follow the Robinhood request supplied on stdin. Return only the requested JSON object.'], input: prompt }, signal);
  }
}

export class GeminiCliBridge implements Connector {
  private active?: AbortController;
  constructor(private readonly runner: GeminiRunner = new GeminiProcess()) {}
  async close() { this.active?.abort(); }
  async models(): Promise<ModelInfo[]> { return geminiCLIModels.map(model => ({ ...model })); }
  route(model: string): Route {
    return { id: `gemini-cli/${model}`, provider: 'gemini-cli', model,
      manualApproval: 'Gemini CLI uses your native Google login. Free quota and model access depend on that account and are not verified by Robinhood. The CLI may route or retry internally within a two-minute deadline. Review Google account terms before sending project content.',
      complete: async (messages, signal, onText, consent) => {
        manualConsent(consent);
        const selected = geminiCLIModels.find(item => item.id === model);
        if (!selected) throw new RouteError('Choose a supported model from /models gemini-cli.', 'policy');
        const prompt = `You are the model backend for Robinhood. Native tools are disabled. Return ONE JSON object conforming to this schema: ${JSON.stringify(outputSchema)}. No markdown. To inspect or change the real workspace, propose Robinhood tool calls as data; Robinhood will approve and execute them. An empty tool_calls array finishes your response. Completed receipts are historical actions; never repeat them.\nAvailable tools: ${JSON.stringify(toolDefinitions)}\nConversation: ${JSON.stringify(chatMessages(messages, 'gemini-cli', model))}`;
        contextBudget({ prompt }, selected.context);
        this.active = new AbortController();
        try {
          const raw = await this.runner.run(model, prompt, AbortSignal.any([signal, this.active.signal, AbortSignal.timeout(120000)]));
          let outer: Record<string, unknown>, structured: unknown;
          try {
            outer = object(JSON.parse(raw));
            if (outer.error || typeof outer.response !== 'string') throw new Error('invalid');
            structured = JSON.parse(outer.response.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1'));
          } catch { throw new RouteError('Gemini CLI did not return valid Robinhood JSON. No tools were executed. Check login or select another model.', 'protocol'); }
          const result = engineCompletion({ info: { structured } }, 'Gemini CLI');
          if (result.message.content) onText(result.message.content);
          return result;
        } finally { this.active = undefined; }
      },
    };
  }
}
