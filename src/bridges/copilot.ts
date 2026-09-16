import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { dataPath } from '../paths.js';
import { StructuredHeadlessBridge, type HeadlessRunner } from './structured-headless.js';
import { minimalEnvironment, runHeadless, type HeadlessRequest } from './headless-process.js';
import { object } from '../providers/chat-completions.js';
import { RouteError } from '../types.js';

export const COPILOT_VERSION = '1.0.85';
export const copilotProfile = () => path.join(dataPath(), 'cli-profiles', 'copilot');
export const copilotModels = ['claude-haiku-4.5', 'claude-sonnet-4.6', 'gpt-5.4', 'gemini-3.1-pro-preview'].map(id => ({ id, context: 64000 }));

export async function prepareCopilot(profile: string, fixture?: { baseURL: string }): Promise<Omit<HeadlessRequest, 'input'>> {
  const require = createRequire(import.meta.url);
  let file: string;
  try { file = require.resolve('@github/copilot/package.json'); }
  catch { throw new Error('Copilot CLI is missing. Run npm install --include=optional in the Robinhood checkout.'); }
  const pkg = JSON.parse(await readFile(file, 'utf8')) as { version: string; bin: { copilot: string } };
  if (pkg.version !== COPILOT_VERSION) throw new Error(`This bridge requires Copilot CLI ${COPILOT_VERSION}. Run npm ci.`);
  const cwd = path.join(profile, 'workspace'); await mkdir(cwd, { recursive: true, mode: 0o700 });
  if (fixture && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(fixture.baseURL).hostname)) throw new Error('Fixture transport must be loopback.');
  return {
    command: process.execPath, args: [path.resolve(path.dirname(file), pkg.bin.copilot)], cwd,
    env: { ...minimalEnvironment(), HOME: profile, USERPROFILE: profile, COPILOT_HOME: profile, COPILOT_CACHE_HOME: path.join(profile, 'cache'),
      ...(fixture ? { COPILOT_PROVIDER_BASE_URL: fixture.baseURL, COPILOT_PROVIDER_TYPE: 'openai', COPILOT_PROVIDER_WIRE_API: 'completions' } : {}),
    },
  };
}

export async function loginCopilot(profile = copilotProfile()): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run robinhood login copilot-cli in an interactive terminal.');
  const request = await prepareCopilot(profile);
  const child = spawn(request.command, [...request.args, '--no-auto-update', 'login'], { cwd: request.cwd, env: request.env, stdio: 'inherit', windowsHide: true });
  const [code] = await once(child, 'close');
  if (code !== 0) throw new Error('Copilot sign-in did not complete. Retry robinhood login copilot-cli.');
  console.log('Run robinhood, then /connect copilot-cli and /models copilot-cli. Model access and allowance depend on your GitHub account.');
}

export const copilotSafetyArgs = [
  '--no-auto-update', '--no-custom-instructions', '--disable-builtin-mcps', '--no-ask-user', '--no-remote-export', '--no-bash-env',
  // An empty allowlist means defaults in this pinned CLI. A nonmatching name selects no tools.
  '--available-tools=robinhood_no_native_tools', '--deny-tool=shell,read,write,url,memory', '--silent', '--stream', 'off', '--output-format', 'json', '--log-level', 'none',
];
export function copilotResponse(raw: string): string {
  let response: string | undefined, completed = false;
  for (const line of raw.split(/\r?\n/).filter(line => line.trim())) {
    let event: Record<string, unknown>;
    try { event = object(JSON.parse(line)); } catch { throw new RouteError('Copilot returned invalid JSON events.', 'protocol'); }
    const data = object(event.data);
    if (event.type === 'session.error' || event.type === 'error' || event.type === 'tool.execution_start' || Array.isArray(data.toolRequests) && data.toolRequests.length) throw new RouteError('Copilot returned an error or unexpected native tool activity. No Robinhood tool was executed.', 'protocol');
    if (event.type === 'assistant.message' && typeof data.content === 'string') response = data.content;
    if (event.type === 'result') {
      if (event.exitCode !== 0) throw new RouteError('Copilot did not complete the request successfully.', 'protocol');
      completed = true;
    }
  }
  if (!completed || !response?.trim()) throw new RouteError('Copilot did not return a completed assistant response.', 'protocol');
  return JSON.stringify({ response });
}
export class CopilotProcess implements HeadlessRunner {
  constructor(private readonly profile = copilotProfile(), private readonly fixture?: { baseURL: string }) {}
  async run(model: string, prompt: string, signal: AbortSignal): Promise<string> {
    const request = await prepareCopilot(this.profile, this.fixture);
    const response = await runHeadless({ ...request, args: [...request.args, ...copilotSafetyArgs, '--model', model], input: prompt }, signal);
    return copilotResponse(response);
  }
}
export class CopilotBridge extends StructuredHeadlessBridge {
  constructor(runner: HeadlessRunner = new CopilotProcess()) {
    super({ id: 'copilot-cli', label: 'Copilot CLI', models: copilotModels,
      notice: 'Copilot CLI uses your native GitHub login. Free allowance, model eligibility and AI credits depend on your account; this request may consume paid credits. Robinhood does not verify the remaining balance. The native CLI may retry or make utility requests within the two-minute deadline.',
    }, runner);
  }
}
