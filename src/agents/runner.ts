import type { ToolActor, ToolInvocationContext } from "@/authz/types";
import type { AgentIdentity, AgentEvent, CreateAgentEvent } from "@/lib/domain";
import { redact } from "@/lib/logger";
import { decodeStructured, isModelError, ModelError } from "@/llm";
import type { ModelMessage, ModelProvider } from "@/llm";
import {
  budgetMessage,
  checkIterationBudget,
  checkToolBudget,
  createBudgetState,
  recordModelInvocation,
  recordToolCall,
  type RunBudgets,
} from "@/runs/budgets";
import type { EventStore, RunStore } from "@/runs/stores";
import type { AgentFailureCode, AgentRunOutcome } from "@/runs/types";
import type { ToolInvocationResult } from "@/tools/types";
import type { z } from "zod";

export type ToolInvoker = {
  invoke(
    toolName: string,
    rawArgs: unknown,
    context: ToolInvocationContext,
  ): Promise<ToolInvocationResult>;
};

export type AgentStep<TResult> =
  | { type: "think"; thought: string }
  | { type: "tool_call"; toolName: string; arguments: Record<string, unknown> }
  | { type: "finish"; result: TResult };

export type ResultRefinement<TResult> =
  | { ok: true; result: TResult; notes?: string[] }
  | { ok: false; issues: string[] };

export type AgentDefinition<TResult> = {
  name: AgentIdentity;
  systemPrompt: string;
  stepSchema: z.ZodType<AgentStep<TResult>>;
  schemaName: string;
  refineResult?: (
    result: TResult,
    context: {
      retrievedCitationIds: Set<string>;
      successfulTools: string[];
    },
  ) => ResultRefinement<TResult>;
};

export type AgentRunRequest = {
  actor: ToolActor;
  patientId: string;
  userContent: unknown;
  agentRunId?: string;
};

export type AgentRunner<TResult> = {
  run(request: AgentRunRequest): Promise<AgentRunOutcome<TResult>>;
};

const MAX_OBSERVATION_CHARS = 4000;

export function createAgentRunner<TResult>(deps: {
  definition: AgentDefinition<TResult>;
  model: ModelProvider;
  gateway: ToolInvoker;
  runs: RunStore;
  events: EventStore;
  budgets: RunBudgets;
}): AgentRunner<TResult> {
  return {
    async run(request) {
      const run = await deps.runs.create({
        id: request.agentRunId,
        patientId: request.patientId,
        agentName: deps.definition.name,
        status: "running",
      });

      const messages: ModelMessage[] = [
        { role: "system", content: deps.definition.systemPrompt },
        { role: "user", content: request.userContent },
      ];
      const state = createBudgetState();
      const retrievedCitationIds = new Set<string>();
      const successfulTools: string[] = [];
      let schemaRetries = 0;
      let providerRetries = 0;

      try {
        while (true) {
          const iterationBlock = checkIterationBudget(state, deps.budgets);
          if (iterationBlock) {
            return fail(deps, run.id, "BUDGET_EXHAUSTED", budgetMessage(iterationBlock));
          }

          let completion;
          try {
            completion = await deps.model.complete({
              messages,
              schemaName: deps.definition.schemaName,
            });
            providerRetries = 0;
          } catch (error) {
            const modelError = toModelError(error);
            await recordEvent(deps.events, {
              agentRunId: run.id,
              eventType: "error",
              input: { kind: "model_invocation", iteration: state.modelInvocations },
              output: { code: modelError.code, message: modelError.message },
            });
            if (providerRetries < deps.budgets.maxProviderRetries) {
              providerRetries += 1;
              messages.push({
                role: "user",
                content: {
                  type: "control_error",
                  code: modelError.code,
                  message: "The model provider failed. Propose the next structured step.",
                },
              });
              continue;
            }
            return fail(deps, run.id, "PROVIDER_FAILURE", modelError.message);
          }

          recordModelInvocation(state, completion.usage);
          await recordEvent(deps.events, {
            agentRunId: run.id,
            eventType: "think",
            input: {
              kind: "model_invocation",
              iteration: state.modelInvocations,
              schemaName: deps.definition.schemaName,
            },
            output: jsonSafe(completion.content),
          });

          let step: AgentStep<TResult>;
          try {
            step = decodeStructured(
              completion.content,
              deps.definition.stepSchema,
              deps.definition.schemaName,
            );
            schemaRetries = 0;
          } catch (error) {
            const modelError = toModelError(error);
            await recordEvent(deps.events, {
              agentRunId: run.id,
              eventType: "error",
              input: { kind: "schema_failure" },
              output: { code: modelError.code, message: modelError.message, details: modelError.details },
            });
            if (schemaRetries < deps.budgets.maxSchemaRetries) {
              schemaRetries += 1;
              messages.push({
                role: "user",
                content: {
                  type: "control_error",
                  code: "SCHEMA_FAILURE",
                  message: "Output must match the step schema. Emit think, tool_call, or finish only.",
                  details: modelError.details,
                },
              });
              continue;
            }
            return fail(deps, run.id, "SCHEMA_FAILURE", modelError.message);
          }

          if (step.type === "think") {
            messages.push({ role: "assistant", content: step });
            await recordEvent(deps.events, {
              agentRunId: run.id,
              eventType: "think",
              input: { kind: "thought" },
              output: { thought: step.thought },
            });
            continue;
          }

          if (step.type === "tool_call") {
            const toolBlock = checkToolBudget(state, deps.budgets, step.toolName);
            if (toolBlock) {
              return fail(deps, run.id, "BUDGET_EXHAUSTED", budgetMessage(toolBlock));
            }

            recordToolCall(state, step.toolName);
            messages.push({ role: "assistant", content: step });
            await recordEvent(deps.events, {
              agentRunId: run.id,
              eventType: "tool_call",
              toolName: step.toolName,
              input: jsonSafe(step.arguments),
            });

            const invocation = await deps.gateway.invoke(step.toolName, step.arguments, {
              actor: request.actor,
              agentName: deps.definition.name,
              patientScope: request.patientId,
              agentRunId: run.id,
              phase: "agent_loop",
            });

            const observation = toObservation(invocation);
            if (invocation.ok) {
              successfulTools.push(step.toolName);
              for (const citationId of collectCitationIdsFrom(invocation.output)) {
                retrievedCitationIds.add(citationId);
              }
            }

            await recordEvent(deps.events, {
              agentRunId: run.id,
              eventType: "tool_result",
              toolName: step.toolName,
              input: jsonSafe(step.arguments),
              output: observation,
            });
            messages.push({ role: "tool", name: step.toolName, content: observation });
            continue;
          }

          const refined = deps.definition.refineResult
            ? deps.definition.refineResult(step.result, {
                retrievedCitationIds,
                successfulTools,
              })
            : { ok: true as const, result: step.result, notes: [] };

          if (!refined.ok) {
            await recordEvent(deps.events, {
              agentRunId: run.id,
              eventType: "error",
              input: { kind: "invalid_result" },
              output: { issues: refined.issues },
            });
            if (schemaRetries < deps.budgets.maxSchemaRetries) {
              schemaRetries += 1;
              messages.push({ role: "assistant", content: step });
              messages.push({
                role: "user",
                content: {
                  type: "control_error",
                  code: "INVALID_RESULT",
                  message:
                    "The finish result was rejected by deterministic checks. Do not diagnose. Cite only retrieved snippet IDs. If evidence is insufficient, finish with uncertainty and no unsupported claims.",
                  issues: refined.issues,
                },
              });
              continue;
            }
            return fail(deps, run.id, "INVALID_RESULT", refined.issues.join("; "));
          }

          if (refined.notes && refined.notes.length > 0) {
            await recordEvent(deps.events, {
              agentRunId: run.id,
              eventType: "policy_decision",
              input: { kind: "result_overlay" },
              output: { notes: refined.notes },
            });
          }

          await recordEvent(deps.events, {
            agentRunId: run.id,
            eventType: "finish",
            output: jsonSafe(refined.result),
          });
          await deps.runs.update(run.id, {
            status: "completed",
            completedAt: new Date(),
          });

          return {
            ok: true,
            status: "completed",
            runId: run.id,
            result: refined.result,
            events: await deps.events.listByAgentRunId(run.id),
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "agent run failed";
        return fail(deps, run.id, "PROVIDER_FAILURE", message);
      }
    },
  };
}

async function fail<TResult>(
  deps: { runs: RunStore; events: EventStore },
  runId: string,
  code: AgentFailureCode,
  message: string,
): Promise<AgentRunOutcome<TResult>> {
  await recordEvent(deps.events, {
    agentRunId: runId,
    eventType: "error",
    input: { kind: "run_failed", code },
    output: { message },
  });
  await deps.runs.update(runId, { status: "failed", completedAt: new Date() });
  return {
    ok: false,
    status: "failed",
    runId,
    code,
    message,
    events: await deps.events.listByAgentRunId(runId),
  };
}

async function recordEvent(events: EventStore, event: CreateAgentEvent): Promise<AgentEvent> {
  return events.create({
    ...event,
    input: redact(event.input),
    output: redact(event.output),
  });
}

function toObservation(result: ToolInvocationResult): unknown {
  if (result.ok) {
    return clip({
      type: "tool_observation",
      toolName: result.toolName,
      ok: true,
      output: jsonSafe(result.output),
    });
  }

  return clip({
    type: "tool_observation",
    toolName: result.toolName,
    ok: false,
    error: {
      code: result.error.code,
      message: result.error.message,
    },
  });
}

function collectCitationIdsFrom(value: unknown): string[] {
  const ids: string[] = [];
  const visit = (node: unknown) => {
    if (typeof node === "string" && /^cite:[A-Za-z0-9_-]+:\d+$/.test(node)) {
      ids.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const nested of Object.values(node)) {
        visit(nested);
      }
    }
  };
  visit(value);
  return ids;
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null));
}

function clip(value: unknown): unknown {
  const encoded = JSON.stringify(value);
  if (encoded.length <= MAX_OBSERVATION_CHARS) {
    return value;
  }
  return { truncated: true, preview: encoded.slice(0, MAX_OBSERVATION_CHARS) };
}

function toModelError(error: unknown): ModelError {
  if (isModelError(error)) {
    return error;
  }
  return new ModelError(
    "PROVIDER_FAILURE",
    error instanceof Error ? error.message : "model provider failed",
  );
}
