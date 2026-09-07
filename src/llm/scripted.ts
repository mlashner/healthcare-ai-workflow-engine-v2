import { ModelError } from "./errors";
import { usageFromContent } from "./cost";
import type {
  ModelCompletion,
  ModelMessage,
  ModelMetadata,
  ModelProvider,
  ModelStreamEvent,
} from "./types";

export type ScriptedStep =
  | unknown
  | ((messages: ModelMessage[]) => unknown | Promise<unknown>);

export type ScriptedProviderOptions = {
  model?: string;
  displayName?: string;
};

const scriptedMetadata = (options?: ScriptedProviderOptions): ModelMetadata => ({
  id: "scripted",
  displayName: options?.displayName ?? "Scripted deterministic fake",
  model: options?.model ?? "scripted",
  supportsStructuredOutput: true,
  supportsToolCalling: true,
  supportsStreaming: true,
});

/**
 * Deterministic provider for tests, eval, and local replay. Each `complete`
 * call consumes the next scripted step. Swap this for a hosted provider
 * without changing the agent loop.
 */
export function createScriptedModelProvider(
  script: ScriptedStep[],
  options?: ScriptedProviderOptions,
): ModelProvider {
  let index = 0;
  const metadata = scriptedMetadata(options);

  const complete: ModelProvider["complete"] = async (request) => {
    if (index >= script.length) {
      throw new ModelError("EMPTY_RESPONSE", "scripted provider has no remaining steps");
    }

    const step = script[index];
    index += 1;
    const content = typeof step === "function" ? await step(request.messages) : step;
    return {
      content,
      usage: usageFromContent(request.messages, content),
      finishReason: "stop",
    } satisfies ModelCompletion;
  };

  return {
    metadata,
    complete,
    async *stream(request): AsyncIterable<ModelStreamEvent> {
      const completion = await complete(request);
      const text = typeof completion.content === "string" ? completion.content : "";
      if (text) {
        yield { type: "delta", text };
      }
      yield { type: "completed", completion };
    },
  };
}

export function createFailingModelProvider(error: Error): ModelProvider {
  const fail = async (): Promise<ModelCompletion> => {
    throw error;
  };
  return {
    metadata: {
      id: "failing",
      displayName: "Failing fake",
      model: "failing",
      supportsStructuredOutput: false,
      supportsToolCalling: false,
      supportsStreaming: false,
    },
    complete: fail,
    async *stream() {
      await fail();
    },
  };
}
