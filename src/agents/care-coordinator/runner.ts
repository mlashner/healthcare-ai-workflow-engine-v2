import { defaultCareCoordinatorBudgets, mergeBudgets, type RunBudgets } from "@/runs/budgets";
import type { EventStore, RunStore } from "@/runs/stores";
import type { AgentRunOutcome } from "@/runs/types";
import { reviewCareCoordinatorSafety } from "@/safety";
import type { ModelProvider } from "@/llm";
import type { ToolInvoker } from "../runner";

import { createAgentRunner } from "../runner";
import { buildCareCoordinatorUserMessage, CARE_COORDINATOR_SCHEMA_NAME, careCoordinatorSystemPrompt } from "./prompt";
import { validateCareCoordinatorResult } from "./result";
import {
  careCoordinatorRunInputSchema,
  careCoordinatorStepSchema,
  type CareCoordinatorResult,
  type CareCoordinatorRunInput,
} from "./schemas";

export function createCareCoordinatorRunner(deps: {
  model: ModelProvider;
  gateway: ToolInvoker;
  runs: RunStore;
  events: EventStore;
  budgets?: Partial<RunBudgets>;
}) {
  const runner = createAgentRunner<CareCoordinatorResult>({
    definition: {
      name: "care_coordinator",
      systemPrompt: careCoordinatorSystemPrompt,
      stepSchema: careCoordinatorStepSchema,
      schemaName: CARE_COORDINATOR_SCHEMA_NAME,
      refineResult: validateCareCoordinatorResult,
      safetyReview: reviewCareCoordinatorSafety,
    },
    model: deps.model,
    gateway: deps.gateway,
    runs: deps.runs,
    events: deps.events,
    budgets: mergeBudgets(defaultCareCoordinatorBudgets, deps.budgets),
  });

  return {
    async run(input: CareCoordinatorRunInput): Promise<AgentRunOutcome<CareCoordinatorResult>> {
      const request = careCoordinatorRunInputSchema.parse(input);
      return runner.run({
        actor: request.actor,
        patientId: request.patientId,
        agentRunId: request.agentRunId,
        userContent: buildCareCoordinatorUserMessage(request),
      });
    },
  };
}

export type CareCoordinatorRunner = ReturnType<typeof createCareCoordinatorRunner>;
