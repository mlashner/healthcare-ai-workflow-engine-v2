export type ModelRole = "system" | "user" | "assistant" | "tool";

export type ModelMessage = {
  role: ModelRole;
  content: unknown;
  name?: string;
};

export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

/**
 * Provider-agnostic completion request. Business logic never depends on a
 * specific vendor SDK. A future OpenAI/Anthropic adapter implements this port.
 */
export type ModelRequest = {
  messages: ModelMessage[];
  schemaName: string;
};

export type ModelCompletion = {
  content: unknown;
  usage?: ModelUsage;
};

export type ModelProvider = {
  complete(request: ModelRequest): Promise<ModelCompletion>;
};
