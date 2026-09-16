export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  source?: { provider: string; model: string };
  providerState?: { provider: string; model: string; parts: Record<string, unknown>[]; chat?: Record<string, unknown> };
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface Completion {
  message: Message;
  usage?: Usage;
}

export interface Route {
  id: string;
  provider: string;
  model: string;
  manualApproval?: string;
  // Must enforce eligibility before every inference request. No implicit retries.
  complete(messages: Message[], signal: AbortSignal, onText: (text: string) => void, consent?: { confirmed: boolean }): Promise<Completion>;
}

export interface ModelInfo { id: string; context: number }
export interface Connector {
  models(signal?: AbortSignal): Promise<ModelInfo[]>;
  route(model: string): Route;
}

export class RouteError extends Error {
  constructor(message: string, readonly kind: 'quota' | 'capacity' | 'auth' | 'policy' | 'protocol', readonly retryAfterMs?: number) {
    super(message);
    this.name = 'RouteError';
  }
}

export interface Session {
  id: string;
  workspace: string;
  identity: string;
  objective: string;
  route: string | null;
  created_at: string;
}

export interface Operation {
  id: string;
  session_id: string;
  call_id: string;
  name: string;
  args: string;
  state: 'prepared' | 'running' | 'completed' | 'failed' | 'unknown';
  result: string | null;
}
