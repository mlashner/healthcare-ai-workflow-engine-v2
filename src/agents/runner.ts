import type { ToolActor, ToolInvocationContext } from "@/authz/types";
import type { AgentIdentity, AgentEvent, CreateAgentEvent } from "@/lib/domain";
import { logger, redact } from "@/lib/logger";
import { decodeStructured, isModelError, ModelError } from "@/llm";
import { createTimedModelProvider, withTimeout } from "@/llm/timeout";
import type { ModelMessage, ModelProvider } from "@/llm";
import {
  buildRunTelemetry,
  modelInvocationInput,
  RUN_TELEMETRY_KIND,
  type RunTelemetry,
} from "@/observability";
import {
  budgetMessage,
  checkIterationBudget,
  checkThinkBudget,
  checkToolBudget,
  createBudgetState,
  estimateTokens,
  recordModelInvocation,
  recordToolCall,
  type RunBudgets,
} from "@/runs/budgets";
import type { RunRateLimiter } from "@/runs/rate-limit";
import type { EventStore, RunStore } from "@/runs/stores";
import type { AgentFailureCode, AgentRunOutcome } from "@/runs/types";
import type { RetrievedSnippet } from "@/safety";
import type { ToolInvocationResult } from "@/tools/types";
import type { z } from "zod";

import { wrapToolOutput } from "./untrusted";

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

export type SafetyGate = {
  passed: boolean;
  issues: string[];
};

export type AgentDefinition<TResult> = {
  name: AgentIdentity;
  systemPrompt: string;
  stepSchema: z.ZodType<AgentStep<TResult>>;
  schemaName: string;
  refineResult?: (
    result: TResult,
    context: { retrievedCitationIds: Set<string> },
  ) => ResultRefinement<TResult>;
  safetyReview?: (
    result: TResult,
    context: { patientScope: string; retrievedSnippets: RetrievedSnippet[] },
  ) => SafetyGate;
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
  limiter?: RunRateLimiter;
}): AgentRunner<TResult> {
  const model = createTimedModelProvider(deps.model, deps.budgets.providerTimeoutMs);

  return {
    async run(request) {
      const run = await deps.runs.create({
        id: request.agentRunId,
        patientId: request.patientId,
        agentName: deps.definition.name,
        status: "running",
      });

      const terminal = { model, startedAt: run.startedAt, agentName: deps.definition.name };

      const admitted = deps.limiter?.acquire(request.actor.id) ?? { ok: true as const };
      if (!admitted.ok) {
        return fail(deps, run.id, "RATE_LIMITED", admitted.reason, terminal);
      }

      try {
        return await withTimeout(
          executeLoop(deps, model, request, run.id, run.startedAt),
          deps.budgets.runTimeoutMs,
          `agent run timed out after ${deps.budgets.runTimeoutMs}ms`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "agent run failed";
        return fail(deps, run.id, "PROVIDER_FAILURE", message, terminal);
      } finally {
        deps.limiter?.release(request.actor.id);
      }
    },
  };
}

async function executeLoop<TResult>(
  deps: {
    definition: AgentDefinition<TResult>;
    gateway: ToolInvoker;
    runs: RunStore;
    events: EventStore;
    budgets: RunBudgets;
  },
  model: ModelProvider,
  request: AgentRunRequest,
  runId: string,
  startedAt: Date,
): Promise<AgentRunOutcome<TResult>> {
  const terminal = { model, startedAt, agentName: deps.definition.name };
  const messages: ModelMessage[] = [
    { role: "system", content: deps.definition.systemPrompt },
    { role: "user", content: request.userContent },
  ];
  const state = createBudgetState();
  const retrievedSnippets: RetrievedSnippet[] = [];
  let schemaRetries = 0;
  let providerRetries = 0;

  while (true) {
    const iterationBlock = checkIterationBudget(state, deps.budgets);
    if (iterationBlock) {
      return fail(deps, runId, "BUDGET_EXHAUSTED", budgetMessage(iterationBlock), terminal);
    }

    let completion;
    const invocationStarted = performance.now();
    try {
      completion = await model.complete({
        messages,
        schemaName: deps.definition.schemaName,
      });
      providerRetries = 0;
    } catch (error) {
      const modelError = toModelError(error);
      await recordEvent(deps.events, {
        agentRunId: runId,
        eventType: "error",
        input: modelInvocationInput({
          iteration: state.modelInvocations,
          schemaName: deps.definition.schemaName,
          metadata: model.metadata,
          latencyMs: performance.now() - invocationStarted,
          failed: true,
        }),
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
      return fail(deps, runId, "PROVIDER_FAILURE", modelError.message, terminal);
    }

    const usage = completion.usage ?? {
      inputTokens: estimateTokens(messages),
      outputTokens: estimateTokens(completion.content),
    };
    recordModelInvocation(state, usage);
    await recordEvent(deps.events, {
      agentRunId: runId,
      eventType: "think",
      input: modelInvocationInput({
        iteration: state.modelInvocations,
        schemaName: deps.definition.schemaName,
        metadata: model.metadata,
        usage,
        latencyMs: performance.now() - invocationStarted,
      }),
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
        agentRunId: runId,
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
      return fail(deps, runId, "SCHEMA_FAILURE", modelError.message, terminal);
    }

    if (step.type === "think") {
      state.consecutiveThinks += 1;
      const thinkBlock = checkThinkBudget(state, deps.budgets);
      if (thinkBlock) {
        return fail(deps, runId, "BUDGET_EXHAUSTED", budgetMessage(thinkBlock), terminal);
      }
      messages.push({ role: "assistant", content: step });
      await recordEvent(deps.events, {
        agentRunId: runId,
        eventType: "think",
        input: { kind: "thought" },
        output: { thought: step.thought },
      });
      continue;
    }

    state.consecutiveThinks = 0;

    if (step.type === "tool_call") {
      const toolBlock = checkToolBudget(state, deps.budgets, step.toolName);
      if (toolBlock) {
        return fail(deps, runId, "BUDGET_EXHAUSTED", budgetMessage(toolBlock), terminal);
      }

      recordToolCall(state, step.toolName);
      messages.push({ role: "assistant", content: step });
      await recordEvent(deps.events, {
        agentRunId: runId,
        eventType: "tool_call",
        toolName: step.toolName,
        input: jsonSafe(step.arguments),
      });

      const invocation = await deps.gateway.invoke(step.toolName, step.arguments, {
        actor: request.actor,
        agentName: deps.definition.name,
        patientScope: request.patientId,
        agentRunId: runId,
        phase: "agent_loop",
      });

      const observation = toObservation(invocation);
      if (invocation.ok) {
        retrievedSnippets.push(...collectSnippets(invocation.output));
      }

      await recordEvent(deps.events, {
        agentRunId: runId,
        eventType: "tool_result",
        toolName: step.toolName,
        input: jsonSafe(step.arguments),
        output: observation,
      });
      messages.push({ role: "tool", name: step.toolName, content: observation });
      continue;
    }

    const retrievedCitationIds = new Set(retrievedSnippets.map((snippet) => snippet.citationId));
    const refined = deps.definition.refineResult
      ? deps.definition.refineResult(step.result, { retrievedCitationIds })
      : { ok: true as const, result: step.result, notes: [] };

    if (!refined.ok) {
      await recordEvent(deps.events, {
        agentRunId: runId,
        eventType: "error",
        input: { kind: "invalid_result" },
        output: { issues: refined.issues },
      });
      if (schemaRetries < deps.budgets.maxSchemaRetries) {
        schemaRetries += 1;
        queueRetry(messages, step, refined.issues, "INVALID_RESULT");
        continue;
      }
      return fail(deps, runId, "INVALID_RESULT", refined.issues.join("; "), terminal);
    }

    if (refined.notes && refined.notes.length > 0) {
      await recordEvent(deps.events, {
        agentRunId: runId,
        eventType: "policy_decision",
        input: { kind: "result_overlay" },
        output: { notes: refined.notes },
      });
    }

    const safety = deps.definition.safetyReview
      ? deps.definition.safetyReview(refined.result, {
          patientScope: request.patientId,
          retrievedSnippets,
        })
      : { passed: true, issues: [] };

    await recordEvent(deps.events, {
      agentRunId: runId,
      eventType: "safety_review",
      input: { kind: "deterministic_safety" },
      output: { passed: safety.passed, issues: safety.issues },
    });

    if (!safety.passed) {
      if (schemaRetries < deps.budgets.maxSchemaRetries) {
        schemaRetries += 1;
        queueRetry(messages, step, safety.issues, "SAFETY_FAILURE");
        continue;
      }
      return fail(deps, runId, "SAFETY_FAILURE", safety.issues.join("; "), terminal);
    }

    await recordEvent(deps.events, {
      agentRunId: runId,
      eventType: "finish",
      output: jsonSafe(refined.result),
    });
    const completedAt = new Date();
    await deps.runs.update(runId, {
      status: "completed",
      completedAt,
    });
    await persistRunTelemetry(deps.events, {
      runId,
      agentName: deps.definition.name,
      status: "completed",
      metadata: model.metadata,
      startedAt,
      completedAt,
    });

    return {
      ok: true,
      status: "completed",
      runId,
      result: refined.result,
      events: await deps.events.listByAgentRunId(runId),
    };
  }
}

function queueRetry<TResult>(
  messages: ModelMessage[],
  step: AgentStep<TResult>,
  issues: string[],
  code: Extract<AgentFailureCode, "INVALID_RESULT" | "SAFETY_FAILURE">,
): true {
  messages.push({ role: "assistant", content: step });
  messages.push({
    role: "user",
    content: {
      type: "control_error",
      code,
      message:
        "The finish result was rejected by deterministic checks. Do not diagnose. Cite only retrieved snippet IDs whose text supports the claim. If evidence is insufficient, finish with uncertainty and no unsupported claims.",
      issues,
    },
  });
  return true;
}

type TerminalContext = {
  model: ModelProvider;
  startedAt: Date;
  agentName: AgentIdentity;
};

async function fail<TResult>(
  deps: { runs: RunStore; events: EventStore },
  runId: string,
  code: AgentFailureCode,
  message: string,
  terminal: TerminalContext,
): Promise<AgentRunOutcome<TResult>> {
  await recordEvent(deps.events, {
    agentRunId: runId,
    eventType: "error",
    input: { kind: "run_failed", code },
    output: { message },
  });
  const completedAt = new Date();
  await deps.runs.update(runId, { status: "failed", completedAt });
  await persistRunTelemetry(deps.events, {
    runId,
    agentName: terminal.agentName,
    status: "failed",
    failureCode: code,
    metadata: terminal.model.metadata,
    startedAt: terminal.startedAt,
    completedAt,
  });
  return {
    ok: false,
    status: "failed",
    runId,
    code,
    message,
    events: await deps.events.listByAgentRunId(runId),
  };
}

async function persistRunTelemetry(
  events: EventStore,
  args: {
    runId: string;
    agentName: AgentIdentity;
    status: "completed" | "failed";
    failureCode?: AgentFailureCode;
    metadata: ModelProvider["metadata"];
    startedAt: Date;
    completedAt: Date;
  },
): Promise<void> {
  try {
    const listed = await events.listByAgentRunId(args.runId);
    const snapshot = buildRunTelemetry({
      runId: args.runId,
      agentName: args.agentName,
      status: args.status,
      failureCode: args.failureCode,
      metadata: args.metadata,
      startedAt: args.startedAt,
      completedAt: args.completedAt,
      events: listed,
    });
    await recordEvent(events, {
      agentRunId: args.runId,
      eventType: "policy_decision",
      input: { kind: RUN_TELEMETRY_KIND },
      output: snapshot,
    });
    logRunTelemetry(snapshot);
  } catch (error) {
    logger.warn("agent.run.telemetry_failed", {
      runId: args.runId,
      message: error instanceof Error ? error.message : "telemetry persist failed",
    });
  }
}

function logRunTelemetry(snapshot: RunTelemetry): void {
  logger.info("agent.run.telemetry", {
    runId: snapshot.runId,
    agentName: snapshot.agentName,
    status: snapshot.status,
    failureCode: snapshot.failureCode,
    model: snapshot.model,
    modelVersion: snapshot.modelVersion,
    inputTokens: snapshot.inputTokens,
    outputTokens: snapshot.outputTokens,
    estimatedCostUsd: snapshot.estimatedCostUsd,
    modelCallCount: snapshot.modelCallCount,
    toolCallCount: snapshot.toolCallCount,
    failedToolCallCount: snapshot.failedToolCallCount,
    modelLatencyMs: snapshot.modelLatencyMs,
    runDurationMs: snapshot.runDurationMs,
    modelFailed: snapshot.modelFailed,
  });
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
      output: wrapToolOutput(result.toolName, jsonSafe(result.output)),
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

function collectSnippets(value: unknown): RetrievedSnippet[] {
  const snippets: RetrievedSnippet[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (node !== null && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (typeof record.citationId === "string" && typeof record.relevantText === "string") {
        snippets.push({ citationId: record.citationId, text: record.relevantText });
      }
      for (const nested of Object.values(record)) {
        visit(nested);
      }
    }
  };
  visit(value);
  return snippets;
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
