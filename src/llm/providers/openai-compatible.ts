import { estimateCostUsd, estimateTextTokens } from "../cost";
import { ModelError } from "../errors";
import type {
  ModelCompletion,
  ModelFinishReason,
  ModelMessage,
  ModelProvider,
  ModelRequest,
  ModelStreamEvent,
  ModelToolCall,
} from "../types";

export type OpenAiCompatibleConfig = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  displayName?: string;
  id?: string;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  fetch?: typeof fetch;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type ChatChoice = {
  finish_reason?: string | null;
  message?: {
    content?: string | null;
    tool_calls?: ChatToolCall[];
  };
  delta?: {
    content?: string | null;
    tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
  };
};

type ChatCompletionResponse = {
  choices?: ChatChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; type?: string; code?: string | number };
};

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * HTTP adapter for OpenAI Chat Completions and compatible gateways
 * (Azure OpenAI, Groq, local servers). Vendor JSON stays inside this file.
 */
export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): ModelProvider {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  const rates = {
    inputUsdPerMillion: config.inputUsdPerMillion ?? 3,
    outputUsdPerMillion: config.outputUsdPerMillion ?? 15,
  };

  const complete: ModelProvider["complete"] = async (request) => {
    const response = await send(fetchImpl, baseUrl, config, request, false);
    const body = (await readJson(response)) as ChatCompletionResponse;
    throwIfHttpError(response, body);
    const choice = body.choices?.[0];
    if (!choice?.message) {
      throw new ModelError("EMPTY_RESPONSE", "openai-compatible provider returned no choices");
    }
    const toolCalls = parseToolCalls(choice.message.tool_calls);
    const content = contentFromMessage(choice.message.content, toolCalls);
    if (content === undefined && toolCalls.length === 0) {
      throw new ModelError("EMPTY_RESPONSE", "openai-compatible provider returned an empty message");
    }
    const usage = usageFrom(body.usage, request.messages, content, rates);
    return {
      content: content ?? null,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      finishReason: mapFinishReason(choice.finish_reason, toolCalls.length > 0),
    } satisfies ModelCompletion;
  };

  return {
    metadata: {
      id: config.id ?? "openai_compatible",
      displayName: config.displayName ?? "OpenAI-compatible",
      model: config.model,
      version: config.model,
      supportsStructuredOutput: true,
      supportsToolCalling: true,
      supportsStreaming: true,
    },
    complete,
    async *stream(request): AsyncIterable<ModelStreamEvent> {
      const response = await send(fetchImpl, baseUrl, config, request, true);
      if (!response.ok) {
        const body = (await readJson(response)) as ChatCompletionResponse;
        throwIfHttpError(response, body);
      }
      if (!response.body) {
        const completion = await complete(request);
        yield { type: "completed", completion };
        return;
      }

      let text = "";
      let toolName: string | undefined;
      let toolArgs = "";
      let finishReason: ModelFinishReason = "stop";
      let usageRaw: ChatCompletionResponse["usage"];

      for await (const payload of readSseData(response.body)) {
        if (payload === "[DONE]") {
          break;
        }
        let parsed: ChatCompletionResponse;
        try {
          parsed = JSON.parse(payload) as ChatCompletionResponse;
        } catch {
          throw new ModelError("PROVIDER_FAILURE", "openai-compatible stream was not valid JSON");
        }
        if (parsed.usage) {
          usageRaw = parsed.usage;
        }
        const delta = parsed.choices?.[0]?.delta;
        if (typeof delta?.content === "string" && delta.content.length > 0) {
          text += delta.content;
          yield { type: "delta", text: delta.content };
        }
        const streamedTool = delta?.tool_calls?.[0]?.function;
        if (streamedTool?.name) {
          toolName = streamedTool.name;
        }
        if (typeof streamedTool?.arguments === "string") {
          toolArgs += streamedTool.arguments;
          yield { type: "tool_call_delta", name: toolName, arguments: streamedTool.arguments };
        }
        const reason = parsed.choices?.[0]?.finish_reason;
        if (reason) {
          finishReason = mapFinishReason(reason, Boolean(toolName));
        }
      }

      const toolCalls = toolName
        ? parseToolCalls([{ function: { name: toolName, arguments: toolArgs } }])
        : [];
      const content = contentFromMessage(text || null, toolCalls);
      if (content === undefined && toolCalls.length === 0) {
        throw new ModelError("EMPTY_RESPONSE", "openai-compatible stream ended without content");
      }
      yield {
        type: "completed",
        completion: {
          content: content ?? null,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage: usageFrom(usageRaw, request.messages, content, rates),
          finishReason,
        },
      };
    },
  };
}

async function send(
  fetchImpl: typeof fetch,
  baseUrl: string,
  config: OpenAiCompatibleConfig,
  request: ModelRequest,
  stream: boolean,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildBody(config.model, request, stream)),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new ModelError("TIMEOUT", "openai-compatible request was aborted");
    }
    throw new ModelError(
      "PROVIDER_FAILURE",
      error instanceof Error ? error.message : "openai-compatible request failed",
    );
  }
  return response;
}

function buildBody(model: string, request: ModelRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: toChatMessages(request.messages),
    stream,
  };

  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  } else if (request.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: request.schemaName,
        strict: true,
        schema: request.jsonSchema,
      },
    };
  } else {
    body.response_format = { type: "json_object" };
  }

  return body;
}

function toChatMessages(messages: ModelMessage[]): ChatMessage[] {
  return messages.map((message) => {
    const content =
      typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? null);
    if (message.role === "tool") {
      const source = message.name ? ` (${message.name})` : "";
      return {
        role: "user",
        content: `Tool observation${source}: ${content}`,
      };
    }
    return {
      role: message.role,
      content,
    };
  });
}

function contentFromMessage(raw: string | null | undefined, toolCalls: ModelToolCall[]): unknown {
  if (toolCalls[0]) {
    return {
      type: "tool_call",
      toolName: toolCalls[0].name,
      arguments: toolCalls[0].arguments,
    };
  }
  if (raw === null || raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function parseToolCalls(calls: ChatToolCall[] | undefined): ModelToolCall[] {
  if (!calls || calls.length === 0) {
    return [];
  }
  return calls.map((call) => {
    const name = call.function?.name;
    if (!name) {
      throw new ModelError("PROVIDER_FAILURE", "openai-compatible tool call is missing a name");
    }
    let parsed: unknown = {};
    const raw = call.function?.arguments ?? "{}";
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ModelError("SCHEMA_FAILURE", "openai-compatible tool arguments were not valid JSON");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ModelError("SCHEMA_FAILURE", "openai-compatible tool arguments must be an object");
    }
    return {
      id: call.id,
      name,
      arguments: parsed as Record<string, unknown>,
    };
  });
}

function usageFrom(
  raw: ChatCompletionResponse["usage"],
  messages: unknown,
  content: unknown,
  rates: { inputUsdPerMillion: number; outputUsdPerMillion: number },
) {
  const inputTokens = raw?.prompt_tokens ?? estimateTextTokens(messages);
  const outputTokens = raw?.completion_tokens ?? estimateTextTokens(content);
  return {
    inputTokens,
    outputTokens,
    totalTokens: raw?.total_tokens ?? inputTokens + outputTokens,
    estimatedCostUsd: estimateCostUsd({ inputTokens, outputTokens }, rates),
  };
}

function mapFinishReason(reason: string | null | undefined, hasTools: boolean): ModelFinishReason {
  if (reason === "length") {
    return "length";
  }
  if (reason === "tool_calls" || hasTools) {
    return "tool_call";
  }
  if (reason === "stop" || reason === "stop_sequence" || !reason) {
    return "stop";
  }
  return "error";
}

function throwIfHttpError(response: Response, body: ChatCompletionResponse): void {
  if (response.ok) {
    return;
  }
  const message = body.error?.message ?? `openai-compatible provider returned HTTP ${response.status}`;
  if (response.status === 429) {
    throw new ModelError("RATE_LIMITED", message, { status: response.status });
  }
  if (response.status === 408) {
    throw new ModelError("TIMEOUT", message, { status: response.status });
  }
  throw new ModelError("PROVIDER_FAILURE", message, { status: response.status });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelError("PROVIDER_FAILURE", "openai-compatible provider returned non-JSON");
  }
}

async function* readSseData(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) {
        yield trimmed.slice(5).trim();
      }
    }
  }
  const trailing = buffer.trim();
  if (trailing.startsWith("data:")) {
    yield trailing.slice(5).trim();
  }
}
