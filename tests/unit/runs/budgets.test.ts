import { describe, expect, it } from "vitest";

import {
  checkIterationBudget,
  checkToolBudget,
  createBudgetState,
  defaultCareCoordinatorBudgets,
  recordModelInvocation,
  recordToolCall,
} from "@/runs";

describe("run budgets", () => {
  it("exhausts the iteration budget after the configured number of model calls", () => {
    const state = createBudgetState();
    const budgets = { ...defaultCareCoordinatorBudgets, maxIterations: 2 };

    expect(checkIterationBudget(state, budgets)).toBeUndefined();
    recordModelInvocation(state);
    recordModelInvocation(state);
    expect(checkIterationBudget(state, budgets)).toBe("MAX_ITERATIONS");
  });

  it("limits total tool calls and repeats of the same tool", () => {
    const state = createBudgetState();
    const budgets = {
      ...defaultCareCoordinatorBudgets,
      maxToolCalls: 3,
      maxRepeatsPerTool: 2,
    };

    recordToolCall(state, "getPatientContext");
    recordToolCall(state, "getPatientContext");
    expect(checkToolBudget(state, budgets, "getPatientContext")).toBe("MAX_TOOL_REPEATS");
    expect(checkToolBudget(state, budgets, "getCarePlan")).toBeUndefined();

    recordToolCall(state, "getCarePlan");
    expect(checkToolBudget(state, budgets, "searchClinicalKnowledge")).toBe("MAX_TOOL_CALLS");
  });
});
