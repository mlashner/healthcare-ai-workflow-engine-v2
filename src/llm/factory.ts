import { createOpenAiCompatibleProvider } from "./providers/openai-compatible";
import { createScriptedModelProvider, type ScriptedStep } from "./scripted";
import type { ModelProvider } from "./types";

export type CreateModelProviderInput =
  | {
      kind: "scripted";
      script: ScriptedStep[];
      model?: string;
    }
  | {
      kind: "openai_compatible";
      apiKey: string;
      model: string;
      baseUrl?: string;
      displayName?: string;
      fetch?: typeof fetch;
    };

/**
 * Composition root for model adapters. Agents receive the resulting
 * `ModelProvider` and never branch on `kind`.
 */
export function createModelProvider(input: CreateModelProviderInput): ModelProvider {
  switch (input.kind) {
    case "scripted":
      return createScriptedModelProvider(input.script, { model: input.model });
    case "openai_compatible":
      return createOpenAiCompatibleProvider({
        apiKey: input.apiKey,
        model: input.model,
        baseUrl: input.baseUrl,
        displayName: input.displayName,
        fetch: input.fetch,
      });
  }
}
