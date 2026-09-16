import { RouteError, type Connector, type ModelInfo, type Route } from '../types.js';
import { engineCompletion, outputSchema } from './opencode.js';
import { toolDefinitions } from '../tools.js';
import { chatMessages } from '../providers/memory.js';
import { object } from '../providers/chat-completions.js';
import { contextBudget, manualConsent } from '../providers/http.js';

export interface HeadlessRunner { run(model: string, prompt: string, signal: AbortSignal): Promise<string> }
export interface HeadlessSpec { id: string; label: string; models: ModelInfo[]; notice: string }

export class StructuredHeadlessBridge implements Connector {
  private active?: AbortController;
  constructor(private readonly spec: HeadlessSpec, private readonly runner: HeadlessRunner) {}
  async close() { this.active?.abort(); }
  async models(): Promise<ModelInfo[]> { return this.spec.models.map(model => ({ ...model })); }
  route(model: string): Route {
    return { id: `${this.spec.id}/${model}`, provider: this.spec.id, model,
      manualApproval: this.spec.notice,
      complete: async (messages, signal, onText, consent) => {
        manualConsent(consent);
        const selected = this.spec.models.find(item => item.id === model);
        if (!selected) throw new RouteError(`Choose a supported model from /models ${this.spec.id}.`, 'policy');
        const prompt = `You are the model backend for Robinhood. Native tools are disabled. Return ONE JSON object conforming to this schema: ${JSON.stringify(outputSchema)}. No markdown. To inspect or change the real workspace, propose Robinhood tool calls as data; Robinhood will approve and execute them. An empty tool_calls array finishes your response. Completed receipts are historical actions; never repeat them.\nAvailable tools: ${JSON.stringify(toolDefinitions)}\nConversation: ${JSON.stringify(chatMessages(messages, this.spec.id, model))}`;
        contextBudget({ prompt }, selected.context);
        this.active = new AbortController();
        try {
          const raw = await this.runner.run(model, prompt, AbortSignal.any([signal, this.active.signal, AbortSignal.timeout(120000)]));
          let outer: Record<string, unknown>, structured: unknown;
          try {
            outer = object(JSON.parse(raw));
            if (outer.error || typeof outer.response !== 'string') throw new Error('invalid');
            structured = JSON.parse(outer.response.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1'));
          } catch { throw new RouteError(`${this.spec.label} did not return valid Robinhood JSON. No tools were executed. Check login or select another model.`, 'protocol'); }
          const result = engineCompletion({ info: { structured } }, this.spec.label);
          if (result.message.content) onText(result.message.content);
          return result;
        } finally { this.active = undefined; }
      },
    };
  }
}
