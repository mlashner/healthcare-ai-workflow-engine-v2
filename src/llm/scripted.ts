import { ModelError } from "./errors";
import type { ModelCompletion, ModelMessage, ModelProvider } from "./types";

export type ScriptedStep =
  | unknown
  | ((messages: ModelMessage[]) => unknown | Promise<unknown>);

/**
 * Deterministic provider for tests and local replay. Each `complete` call
 * consumes the next scripted step. Swap this for a hosted provider without
 * changing the agent loop.
 */
export function createScriptedModelProvider(script: ScriptedStep[]): ModelProvider {
  let index = 0;

  return {
    async complete(request): Promise<ModelCompletion> {
      if (index >= script.length) {
        throw new ModelError("EMPTY_RESPONSE", "scripted provider has no remaining steps");
      }

      const step = script[index];
      index += 1;
      const content = typeof step === "function" ? await step(request.messages) : step;
      return { content };
    },
  };
}

export function createFailingModelProvider(error: Error): ModelProvider {
  return {
    async complete() {
      throw error;
    },
  };
}
