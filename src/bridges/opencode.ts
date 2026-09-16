import { ServerProcess, type Engine } from './server-process.js';
export type { Engine } from './server-process.js';
import { randomUUID } from 'node:crypto';
import { RouteError, type Connector, type ModelInfo, type Route, type Completion } from '../types.js';
import { object } from '../providers/chat-completions.js';
import { contextBudget, manualConsent } from '../providers/http.js';
import { chatMessages } from '../providers/memory.js';
import { toolDefinitions } from '../tools.js';

export const OPENCODE_VERSION = '1.18.31';
export const freeModelIDs = ['big-pickle', 'mimo-v2.5-free', 'ling-3.0-flash-fin-free', 'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free', 'muse-spark-1.3-contributor-free'];

export function engineConfig() {
  return {
    autoupdate: false, share: 'disabled', snapshot: false,
    enabled_providers: ['opencode'], model: 'opencode/big-pickle', small_model: 'opencode/big-pickle',
    provider: { opencode: { whitelist: freeModelIDs } },
    permission: { '*': 'deny', StructuredOutput: 'allow' }, compaction: { auto: false, prune: false },
    agent: {
      robinhood: { mode: 'primary', permission: { '*': 'deny', StructuredOutput: 'allow' }, steps: 2, prompt: 'You provide structured suggestions to Robinhood. Only Robinhood executes tools. Always call StructuredOutput to return your suggestions; this only returns data and does not execute workspace actions.' },
      title: { disable: true }, summary: { disable: true }, compaction: { disable: true },
    },
  };
}

export class OpenCodeProcess extends ServerProcess {
  constructor(config: unknown = engineConfig()) {
    super(config, { packageName: 'opencode-ai', version: OPENCODE_VERSION, bin: 'opencode', envPrefix: 'OPENCODE', directoryHeader: 'x-opencode-directory' });
  }
}

export function freeEngineModels(data: unknown): ModelInfo[] {
  const all = object(data).all;
  if (!Array.isArray(all)) throw new RouteError('OpenCode returned an invalid provider catalog.', 'protocol');
  const models = object(all.find(item => object(item).id === 'opencode')).models;
  return Object.values(object(models)).flatMap(value => {
    const model = object(value), cost = object(model.cost), cache = object(cost.cache), limit = object(model.limit);
    if (typeof model.id !== 'string' || !freeModelIDs.includes(model.id) || model.status === 'deprecated' || object(model.capabilities).toolcall !== true) return [];
    if ([cost.input, cost.output, cache.read, cache.write].some(price => price !== 0) || cost.tiers !== undefined || cost.experimentalOver200K !== undefined) return [];
    if (typeof limit.context !== 'number' || !Number.isFinite(limit.context) || limit.context < 4096) return [];
    return [{ id: model.id, context: Math.min(limit.context, 64000) }];
  });
}

export const outputSchema = {
  type: 'object', additionalProperties: false, required: ['content', 'tool_calls'],
  properties: {
    content: { type: 'string' },
    tool_calls: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['name', 'arguments'], properties: {
      name: { type: 'string', enum: toolDefinitions.map(tool => tool.function.name) }, arguments: { type: 'string', description: 'A JSON-encoded object matching the requested Robinhood tool parameters.' },
    } } },
  },
};

export function engineCompletion(data: unknown): Completion {
  const info = object(object(data).info);
  if (info.error) {
    const error = object(info.error), status = object(error.data).statusCode;
    if (error.name === 'StructuredOutputError') throw new RouteError('This OpenCode model did not return the required structured response. No Robinhood tools were executed. Try another model.', 'protocol');
    if (status === 429) throw new RouteError('OpenCode free model is rate-limited. Wait or select another model; remaining allowance is unknown.', 'quota');
    if (status === 401 || status === 403) throw new RouteError('OpenCode rejected anonymous access to this model. Select another advertised free model.', 'auth');
    throw new RouteError('OpenCode could not complete the request. Reconnect or choose another model.', 'protocol');
  }
  const result = object(info.structured);
  if (typeof result.content !== 'string' || !Array.isArray(result.tool_calls) || result.tool_calls.length > 8) throw new RouteError('OpenCode did not return a valid structured response. No tools were executed.', 'protocol');
  const calls = result.tool_calls.map(item => {
    const call = object(item);
    if (!toolDefinitions.some(tool => tool.function.name === call.name) || typeof call.arguments !== 'string') throw new RouteError('OpenCode returned an unsupported tool.', 'protocol');
    let args: unknown; try { args = JSON.parse(call.arguments); } catch { throw new RouteError('OpenCode returned invalid tool arguments.', 'protocol'); }
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new RouteError('Expected a tool argument object.', 'protocol');
    return { id: randomUUID(), type: 'function' as const, function: { name: call.name as string, arguments: call.arguments } };
  });
  const tokens = object(info.tokens);
  const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
  return { message: { role: 'assistant', content: result.content, ...(calls.length ? { tool_calls: calls } : {}) }, usage: { inputTokens: count(tokens.input), outputTokens: count(tokens.output) } };
}

export class OpenCodeBridge implements Connector {
  private engine?: Engine;
  constructor(private readonly factory: () => Engine = () => new OpenCodeProcess()) {}
  private runtime() { return this.engine ??= this.factory(); }
  async close() { const engine = this.engine; this.engine = undefined; await engine?.close(); }
  async models(signal = AbortSignal.timeout(45_000)): Promise<ModelInfo[]> {
    try { return freeEngineModels(await this.runtime().request('/provider', 'GET', undefined, AbortSignal.any([signal, AbortSignal.timeout(45_000)]))); }
    catch (error) { await this.close(); throw error; }
  }
  route(model: string): Route {
    return { id: `opencode/${model}`, provider: 'opencode', model,
      manualApproval: 'OpenCode CLI free-model bridge. Promotional models may retain data for training; use public, non-confidential data only. Allowance is unknown. OpenCode can retry internally within a two-minute deadline. No paid account credentials are loaded.',
      complete: async (messages, signal, onText, consent) => {
        manualConsent(consent);
        const bounded = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
        const selected = (await this.models(bounded)).find(item => item.id === model);
        if (!selected) throw new RouteError('This model is no longer advertised as free and tool-capable by OpenCode.', 'policy');
        const history = chatMessages(messages, 'opencode', model);
        const prompt = `Return structured suggestions for Robinhood. Do not execute anything yourself. To inspect or change the real workspace, request the following Robinhood tools using tool_calls. Their results arrive in subsequent history. Use content for your user-facing answer; return an empty tool_calls array when finished. Historical tool receipts describe actions already performed; never replay them.\nTools: ${JSON.stringify(toolDefinitions)}\nConversation history: ${JSON.stringify(history)}`;
        contextBudget({ prompt }, selected.context);
        const engine = this.runtime();
        let id: string | undefined;
        try {
          const session = object(await engine.request('/session', 'POST', { title: 'Robinhood model request', permission: [{ permission: '*', pattern: '*', action: 'deny' }, { permission: 'StructuredOutput', pattern: '*', action: 'allow' }] }, bounded));
          if (typeof session.id !== 'string' || !/^[\w-]+$/.test(session.id)) throw new Error('Invalid OpenCode session.');
          id = session.id;
          const result = engineCompletion(await engine.request(`/session/${id}/message`, 'POST', {
            model: { providerID: 'opencode', modelID: model }, agent: 'robinhood',
            format: { type: 'json_schema', schema: outputSchema, retryCount: 0 }, parts: [{ type: 'text', text: prompt }],
          }, bounded));
          if (result.message.content) onText(result.message.content);
          return result;
        } catch (error) { await this.close(); throw error; }
        finally {
          if (id && this.engine === engine) {
            try { await engine.request(`/session/${id}`, 'DELETE', undefined, AbortSignal.timeout(5000)); }
            catch { await this.close(); }
          }
        }
      },
    };
  }
}
