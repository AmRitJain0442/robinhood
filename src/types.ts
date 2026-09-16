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

export interface ToolDefinition {
  type: string;
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

export interface RequestOptions { tools?: ToolDefinition[] }

export interface Route {
  id: string;
  provider: string;
  model: string;
  manualApproval?: string;
  // Direct routes enforce eligibility per inference request without implicit retries.
  // External engines must disclose their own retry and eligibility-check boundaries.
  complete(messages: Message[], signal: AbortSignal, onText: (text: string) => void, consent?: { confirmed: boolean }, options?: RequestOptions): Promise<Completion>;
}

export interface ModelInfo { id: string; context: number }
export interface Connector {
  close?(): Promise<void>;
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
