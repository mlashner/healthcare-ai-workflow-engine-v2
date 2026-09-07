import { defaultCareCoordinatorBudgets, mergeBudgets, type RunBudgets } from "@/runs/budgets";
import { createRunRateLimiter, type RunRateLimiter } from "@/runs/rate-limit";
import { isBoundRunSession } from "@/runs/session";
import type { EventStore, RunStore } from "@/runs/stores";
import type { AgentRunOutcome } from "@/runs/types";
import { reviewCareCoordinatorSafety } from "@/safety";
import type { ModelProvider } from "@/llm";

import { createAgentRunner, type ToolInvoker } from "../runner";
import {
  buildCareCoordinatorUserMessage,
  CARE_COORDINATOR_SCHEMA_NAME,
  careCoordinatorSystemPrompt,
} from "./prompt";
import { validateCareCoordinatorResult } from "./result";
import {
  careCoordinatorEncounterSchema,
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
  limiter?: RunRateLimiter;
}) {
  const budgets = mergeBudgets(defaultCareCoordinatorBudgets, deps.budgets);
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
    budgets,
    limiter: deps.limiter ?? createRunRateLimiter(),
  });

  return {
    async run(input: CareCoordinatorRunInput): Promise<AgentRunOutcome<CareCoordinatorResult>> {
      if (!isBoundRunSession(input.session)) {
        throw new Error("care coordinator runs require a bound session from bindRunSession");
      }
      const encounter = careCoordinatorEncounterSchema.parse(input.encounter);
      return runner.run({
        actor: input.session.actor,
        patientId: input.session.patientId,
        agentRunId: input.agentRunId,
        userContent: buildCareCoordinatorUserMessage({
          patientId: input.session.patientId,
          encounter,
        }),
      });
    },
  };
}

export type CareCoordinatorRunner = ReturnType<typeof createCareCoordinatorRunner>;
