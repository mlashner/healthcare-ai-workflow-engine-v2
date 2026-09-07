import type { AgentEvent, AgentRun, AgentRunStatus } from "@/lib/domain";
import type { ModelMetadata, ModelUsage } from "@/llm";
import type { AgentFailureCode } from "@/runs/types";

export const RUN_TELEMETRY_KIND = "run_telemetry";

/** Keys that must never appear on a telemetry snapshot. */
export const FORBIDDEN_TELEMETRY_KEYS = [
  "name",
  "dateOfBirth",
  "date_of_birth",
  "transcript",
  "medications",
  "conditions",
  "talkingPoints",
  "relevantText",
  "thought",
  "body",
  "patientId",
  "apiKey",
  "password",
  "authorization",
  "DATABASE_URL",
] as const;

export type ModelInvocationMetrics = {
  kind: "model_invocation";
  iteration: number;
  schemaName?: string;
  model: string;
  modelVersion: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  failed?: boolean;
};

export type RunTelemetry = {
  kind: typeof RUN_TELEMETRY_KIND;
  runId: string;
  agentName: string;
  status: AgentRunStatus;
  failureCode: string | null;
  model: string;
  modelVersion: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  modelCallCount: number;
  toolCallCount: number;
  failedToolCallCount: number;
  modelLatencyMs: number;
  runDurationMs: number;
  modelFailed: boolean;
};

export type TelemetryAggregates = {
  runCount: number;
  averageCostUsd: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  averageToolCalls: number;
  modelFailureRate: number;
};

export function modelInvocationInput(args: {
  iteration: number;
  schemaName?: string;
  metadata: ModelMetadata;
  usage?: Pick<ModelUsage, "inputTokens" | "outputTokens" | "estimatedCostUsd">;
  latencyMs: number;
  failed?: boolean;
}): ModelInvocationMetrics {
  return {
    kind: "model_invocation",
    iteration: args.iteration,
    schemaName: args.schemaName,
    model: args.metadata.model,
    modelVersion: args.metadata.version,
    inputTokens: args.usage?.inputTokens ?? 0,
    outputTokens: args.usage?.outputTokens ?? 0,
    estimatedCostUsd: args.usage?.estimatedCostUsd ?? 0,
    latencyMs: Math.max(0, args.latencyMs),
    ...(args.failed ? { failed: true } : {}),
  };
}

export function isRunTelemetryEvent(event: AgentEvent): boolean {
  return (
    event.eventType === "policy_decision" &&
    (isRunTelemetry(event.output) || inputKind(event.input) === RUN_TELEMETRY_KIND)
  );
}

export function isRunTelemetry(value: unknown): value is RunTelemetry {
  return parseRunTelemetry(value) !== null;
}

export function parseRunTelemetry(value: unknown): RunTelemetry | null {
  if (!isRecord(value) || value.kind !== RUN_TELEMETRY_KIND) {
    return null;
  }
  if (typeof value.runId !== "string" || typeof value.agentName !== "string") {
    return null;
  }
  if (typeof value.model !== "string" || typeof value.modelVersion !== "string") {
    return null;
  }
  return sanitizeRunTelemetry({
    kind: RUN_TELEMETRY_KIND,
    runId: value.runId,
    agentName: value.agentName,
    status: asStatus(value.status),
    failureCode: typeof value.failureCode === "string" ? value.failureCode : null,
    model: value.model,
    modelVersion: value.modelVersion,
    inputTokens: asNonNegative(value.inputTokens),
    outputTokens: asNonNegative(value.outputTokens),
    estimatedCostUsd: asNonNegative(value.estimatedCostUsd),
    modelCallCount: asNonNegative(value.modelCallCount),
    toolCallCount: asNonNegative(value.toolCallCount),
    failedToolCallCount: asNonNegative(value.failedToolCallCount),
    modelLatencyMs: asNonNegative(value.modelLatencyMs),
    runDurationMs: asNonNegative(value.runDurationMs),
    modelFailed: value.modelFailed === true,
  });
}

/**
 * Allowlisted snapshot only: model identity, token/cost/latency counters.
 * Never copies event payloads, transcripts, or patient fields.
 */
export function buildRunTelemetry(args: {
  runId: string;
  agentName: string;
  status: AgentRunStatus;
  failureCode?: AgentFailureCode | string | null;
  metadata: ModelMetadata;
  startedAt: Date;
  completedAt?: Date;
  events: AgentEvent[];
}): RunTelemetry {
  const derived = deriveFromEvents(args.events, args.metadata);
  const completedAt = args.completedAt ?? new Date();
  const failureCode = args.failureCode ?? null;
  const modelFailed =
    derived.modelFailed || failureCode === "PROVIDER_FAILURE";

  return sanitizeRunTelemetry({
    kind: RUN_TELEMETRY_KIND,
    runId: args.runId,
    agentName: args.agentName,
    status: args.status,
    failureCode,
    model: derived.model,
    modelVersion: derived.modelVersion,
    inputTokens: derived.inputTokens,
    outputTokens: derived.outputTokens,
    estimatedCostUsd: derived.estimatedCostUsd,
    modelCallCount: derived.modelCallCount,
    toolCallCount: derived.toolCallCount,
    failedToolCallCount: derived.failedToolCallCount,
    modelLatencyMs: derived.modelLatencyMs,
    runDurationMs: durationMs(args.startedAt, completedAt),
    modelFailed,
  });
}

export function telemetryFromRun(run: AgentRun, events: AgentEvent[]): RunTelemetry {
  const recorded = events.map((event) => parseRunTelemetry(event.output)).find((item) => item !== null);
  if (recorded) {
    return {
      ...recorded,
      runId: run.id,
      agentName: run.agentName,
      status: run.status,
      runDurationMs:
        recorded.runDurationMs > 0
          ? recorded.runDurationMs
          : durationMs(run.startedAt, run.completedAt ?? new Date()),
    };
  }

  return buildRunTelemetry({
    runId: run.id,
    agentName: run.agentName,
    status: run.status,
    metadata: {
      id: "unknown",
      displayName: "unknown",
      model: "unknown",
      version: "unknown",
      supportsStructuredOutput: false,
      supportsToolCalling: false,
      supportsStreaming: false,
    },
    startedAt: run.startedAt,
    completedAt: run.completedAt ?? undefined,
    events,
  });
}

export function aggregateTelemetry(rows: RunTelemetry[]): TelemetryAggregates {
  const runCount = rows.length;
  if (runCount === 0) {
    return {
      runCount: 0,
      averageCostUsd: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      averageToolCalls: 0,
      modelFailureRate: 0,
    };
  }

  const latencies = rows.map((row) => row.runDurationMs);
  return {
    runCount,
    averageCostUsd: mean(rows.map((row) => row.estimatedCostUsd)),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    averageToolCalls: mean(rows.map((row) => row.toolCallCount)),
    modelFailureRate: rows.filter((row) => row.modelFailed).length / runCount,
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const low = Math.floor(index);
  const high = Math.ceil(index);
  const lowValue = sorted[low] ?? 0;
  const highValue = sorted[high] ?? lowValue;
  if (low === high) {
    return lowValue;
  }
  return lowValue * (high - index) + highValue * (index - low);
}

export function telemetryContainsForbiddenKeys(value: unknown): string[] {
  const found: string[] = [];
  const forbidden = new Set<string>(FORBIDDEN_TELEMETRY_KEYS);
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (!isRecord(node)) {
      return;
    }
    for (const [key, nested] of Object.entries(node)) {
      if (forbidden.has(key)) {
        found.push(key);
      }
      visit(nested);
    }
  };
  visit(value);
  return found;
}

function deriveFromEvents(events: AgentEvent[], metadata: ModelMetadata) {
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd = 0;
  let modelCallCount = 0;
  let toolCallCount = 0;
  let failedToolCallCount = 0;
  let modelLatencyMs = 0;
  let modelFailed = false;
  let model = metadata.model;
  let modelVersion = metadata.version;

  for (const event of events) {
    if (isRunTelemetryEvent(event)) {
      continue;
    }

    const invocation = parseInvocation(event);
    if (invocation) {
      modelCallCount += 1;
      inputTokens += invocation.inputTokens;
      outputTokens += invocation.outputTokens;
      estimatedCostUsd += invocation.estimatedCostUsd;
      modelLatencyMs += invocation.latencyMs;
      model = invocation.model || model;
      modelVersion = invocation.modelVersion || modelVersion;
      if (invocation.failed || event.eventType === "error") {
        modelFailed = true;
      }
    }

    if (event.eventType === "tool_call") {
      toolCallCount += 1;
    }
    if (event.eventType === "tool_result" && !toolResultOk(event.output)) {
      failedToolCallCount += 1;
    }
  }

  return {
    model,
    modelVersion,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    modelCallCount,
    toolCallCount,
    failedToolCallCount,
    modelLatencyMs,
    modelFailed,
  };
}

function parseInvocation(event: AgentEvent): ModelInvocationMetrics | null {
  if (!isRecord(event.input) || event.input.kind !== "model_invocation") {
    return null;
  }
  return {
    kind: "model_invocation",
    iteration: asNonNegative(event.input.iteration),
    schemaName: typeof event.input.schemaName === "string" ? event.input.schemaName : undefined,
    model: typeof event.input.model === "string" ? event.input.model : "",
    modelVersion: typeof event.input.modelVersion === "string" ? event.input.modelVersion : "",
    inputTokens: asNonNegative(event.input.inputTokens),
    outputTokens: asNonNegative(event.input.outputTokens),
    estimatedCostUsd: asNonNegative(event.input.estimatedCostUsd),
    latencyMs: asNonNegative(event.input.latencyMs),
    failed: event.input.failed === true,
  };
}

function sanitizeRunTelemetry(snapshot: RunTelemetry): RunTelemetry {
  return {
    kind: RUN_TELEMETRY_KIND,
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
  };
}

function durationMs(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : 0;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function asNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function asStatus(value: unknown): AgentRunStatus {
  if (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "running";
}

function inputKind(input: unknown): string | undefined {
  return isRecord(input) && typeof input.kind === "string" ? input.kind : undefined;
}

function toolResultOk(output: unknown): boolean {
  return isRecord(output) ? output.ok !== false : true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
