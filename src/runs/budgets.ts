export type RunBudgets = {
  maxIterations: number;
  maxToolCalls: number;
  maxRepeatsPerTool: number;
  maxSchemaRetries: number;
  maxProviderRetries: number;
  maxTokens?: number;
};

export type BudgetCode =
  | "MAX_ITERATIONS"
  | "MAX_TOOL_CALLS"
  | "MAX_TOOL_REPEATS"
  | "MAX_TOKENS";

export type BudgetState = {
  modelInvocations: number;
  toolCalls: number;
  toolRepeats: Record<string, number>;
  tokens: number;
};

export const defaultCareCoordinatorBudgets: RunBudgets = {
  maxIterations: 10,
  maxToolCalls: 8,
  maxRepeatsPerTool: 2,
  maxSchemaRetries: 2,
  maxProviderRetries: 2,
};

export function createBudgetState(): BudgetState {
  return {
    modelInvocations: 0,
    toolCalls: 0,
    toolRepeats: {},
    tokens: 0,
  };
}

export function mergeBudgets(
  defaults: RunBudgets,
  overrides?: Partial<RunBudgets>,
): RunBudgets {
  return { ...defaults, ...overrides };
}

export function recordModelInvocation(
  state: BudgetState,
  usage?: { inputTokens?: number; outputTokens?: number },
): void {
  state.modelInvocations += 1;
  state.tokens += (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
}

export function recordToolCall(state: BudgetState, toolName: string): void {
  state.toolCalls += 1;
  state.toolRepeats[toolName] = (state.toolRepeats[toolName] ?? 0) + 1;
}

export function checkIterationBudget(
  state: BudgetState,
  budgets: RunBudgets,
): BudgetCode | undefined {
  if (state.modelInvocations >= budgets.maxIterations) {
    return "MAX_ITERATIONS";
  }
  if (budgets.maxTokens !== undefined && state.tokens >= budgets.maxTokens) {
    return "MAX_TOKENS";
  }
  return undefined;
}

export function checkToolBudget(
  state: BudgetState,
  budgets: RunBudgets,
  toolName: string,
): BudgetCode | undefined {
  if (state.toolCalls >= budgets.maxToolCalls) {
    return "MAX_TOOL_CALLS";
  }
  if ((state.toolRepeats[toolName] ?? 0) >= budgets.maxRepeatsPerTool) {
    return "MAX_TOOL_REPEATS";
  }
  return undefined;
}

export function budgetMessage(code: BudgetCode): string {
  switch (code) {
    case "MAX_ITERATIONS":
      return "agent iteration budget exhausted";
    case "MAX_TOOL_CALLS":
      return "agent tool-call budget exhausted";
    case "MAX_TOOL_REPEATS":
      return "repeated the same tool beyond the allowed limit";
    case "MAX_TOKENS":
      return "agent token budget exhausted";
  }
}
