export type ModelRole = "system" | "user" | "assistant" | "tool";

export type ModelMessage = {
  role: ModelRole;
  content: unknown;
  name?: string;
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
};

export type ModelFinishReason = "stop" | "tool_call" | "length" | "error";

export type ModelToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ModelToolCall = {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
};

/**
 * Provider-agnostic completion request. Business logic never depends on a
 * specific vendor SDK. Structured generation is requested by `schemaName`
 * plus optional JSON Schema; native tool calling is optional and unused by
 * the CarePilot agent loop (the gateway owns tools).
 */
export type ModelRequest = {
  messages: ModelMessage[];
  schemaName: string;
  jsonSchema?: Record<string, unknown>;
  tools?: ModelToolDefinition[];
  signal?: AbortSignal;
};

export type ModelCompletion = {
  content: unknown;
  toolCalls?: ModelToolCall[];
  usage: ModelUsage;
  finishReason: ModelFinishReason;
};

export type ModelStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_call_delta"; name?: string; arguments?: string }
  | { type: "completed"; completion: ModelCompletion };

export type ModelMetadata = {
  id: string;
  displayName: string;
  model: string;
  supportsStructuredOutput: boolean;
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
};

/**
 * Port implemented by every model adapter. Agents, eval, and policy depend
 * only on this type. Adding a vendor is a new adapter file plus a factory
 * branch — not a change to those packages.
 */
export type ModelProvider = {
  readonly metadata: ModelMetadata;
  complete(request: ModelRequest): Promise<ModelCompletion>;
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
};
