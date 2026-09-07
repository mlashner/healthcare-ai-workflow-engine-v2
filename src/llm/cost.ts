import type { ModelUsage } from "./types";

export const DEMO_INPUT_USD_PER_MILLION = 3;
export const DEMO_OUTPUT_USD_PER_MILLION = 15;

export function estimateTextTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? "").length / 4);
}

export function estimateCostUsd(
  usage: Pick<ModelUsage, "inputTokens" | "outputTokens">,
  rates: { inputUsdPerMillion: number; outputUsdPerMillion: number } = {
    inputUsdPerMillion: DEMO_INPUT_USD_PER_MILLION,
    outputUsdPerMillion: DEMO_OUTPUT_USD_PER_MILLION,
  },
): number {
  return (
    (usage.inputTokens * rates.inputUsdPerMillion + usage.outputTokens * rates.outputUsdPerMillion) /
    1_000_000
  );
}

export function usageFromContent(
  messages: unknown,
  content: unknown,
  rates?: { inputUsdPerMillion: number; outputUsdPerMillion: number },
): ModelUsage {
  const inputTokens = estimateTextTokens(messages);
  const outputTokens = estimateTextTokens(content);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: estimateCostUsd({ inputTokens, outputTokens }, rates),
  };
}
