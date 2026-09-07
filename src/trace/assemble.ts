import { parsePendingAction } from "@/approval/pending-actions";
import type {
  AgentEvent,
  AgentRun,
  ApprovalRequest,
  AuditEvent,
} from "@/lib/domain";
import type { Repositories } from "@/lib/db/repositories";
import { isRunTelemetryEvent } from "@/observability";
import type { PolicyActor } from "@/policy/action-policy";

import {
  isContextTool,
  isKnowledgeTool,
  isWriteTool,
  traceKinds,
  type TraceKind,
} from "./kinds";
import { redactForTrace } from "./redact";

export type TraceOutcome = "success" | "failure" | "pending";

export type TraceEvent = {
  id: string;
  kind: TraceKind;
  at: Date;
  durationMs: number | null;
  actor: string | null;
  toolName: string | null;
  model: string | null;
  outcome: TraceOutcome;
  input: unknown;
  output: unknown;
};

export type AgentTrace = {
  run: AgentRun;
  events: TraceEvent[];
};

type AssembleInput = {
  run: AgentRun;
  events: AgentEvent[];
  approvals: ApprovalRequest[];
  audits: AuditEvent[];
};

const kindRank = Object.fromEntries(traceKinds.map((kind, index) => [kind, index])) as Record<
  TraceKind,
  number
>;

/**
 * Read-only projection of a run onto the twelve clinician-facing trace kinds.
 * Nothing here is written back; the control plane remains the source of truth.
 */
export function assembleTrace(input: AssembleInput): AgentTrace {
  const { run } = input;
  const items: TraceEvent[] = [];

  items.push({
    id: `${run.id}:started`,
    kind: "agent_started",
    at: run.startedAt,
    durationMs: null,
    actor: run.agentName,
    toolName: null,
    model: null,
    outcome: run.status === "failed" ? "failure" : "success",
    input: { agentName: run.agentName, status: run.status },
    output: run.completedAt ? { completedAt: run.completedAt.toISOString() } : null,
  });

  const toolCallAt = new Map<string, Date>();

  for (const event of input.events) {
    const mapped = mapAgentEvent(event, toolCallAt);
    if (mapped) {
      items.push(mapped);
    }
  }

  for (const approval of input.approvals) {
    const pending = parsePendingAction(approval);
    items.push({
      id: `${approval.id}:requested`,
      kind: "approval_requested",
      at: approval.requestedAt,
      durationMs: null,
      actor: run.agentName,
      toolName: pending?.toolName ?? approval.action.type,
      model: null,
      outcome: "pending",
      input: redactForTrace({
        pendingActionId: approval.id,
        policyActionType: pending?.policyActionType ?? approval.action.type,
      }),
      output: redactForTrace(pending?.proposal ?? approval.action.payload),
    });
  }

  const humanFromEvents = new Set(
    input.events
      .filter((event) => humanDecisionPayload(event.output) !== null)
      .map((event) => humanDecisionPayload(event.output)?.pendingActionId)
      .filter((id): id is string => typeof id === "string"),
  );

  for (const approval of input.approvals) {
    if (approval.status === "pending" || !approval.reviewedAt) {
      continue;
    }
    if (humanFromEvents.has(approval.id)) {
      continue;
    }
    const pending = parsePendingAction(approval);
    items.push({
      id: `${approval.id}:decided`,
      kind: "human_decision",
      at: approval.reviewedAt,
      durationMs: durationMs(approval.requestedAt, approval.reviewedAt),
      actor: approval.reviewer,
      toolName: pending?.toolName ?? approval.action.type,
      model: null,
      outcome: approval.status === "approved" ? "success" : "failure",
      input: { pendingActionId: approval.id },
      output: redactForTrace({ status: approval.status, reason: approval.reason }),
    });
  }

  for (const audit of input.audits) {
    if (audit.outcome === "policy_allowed" || audit.outcome === "policy_denied") {
      items.push({
        id: `${audit.id}:policy`,
        kind: "policy_evaluation",
        at: audit.createdAt,
        durationMs: null,
        actor: audit.actorId,
        toolName: audit.toolName,
        model: null,
        outcome: audit.outcome === "policy_allowed" ? "success" : "failure",
        input: redactForTrace(audit.input),
        output: redactForTrace({
          code: audit.code,
          message: audit.message,
          details: audit.details,
        }),
      });
      continue;
    }

    if (audit.outcome === "executed" && isWriteTool(audit.toolName)) {
      items.push({
        id: `${audit.id}:executed`,
        kind: "action_executed",
        at: audit.createdAt,
        durationMs: null,
        actor: audit.actorId,
        toolName: audit.toolName,
        model: null,
        outcome: "success",
        input: redactForTrace(audit.input),
        output: redactForTrace({ code: audit.code, message: audit.message }),
      });
    }
  }

  items.sort((left, right) => {
    const byTime = left.at.getTime() - right.at.getTime();
    if (byTime !== 0) {
      return byTime;
    }
    return kindRank[left.kind] - kindRank[right.kind] || left.id.localeCompare(right.id);
  });

  fillDurations(items);
  return { run, events: items };
}

export function filterTrace(trace: AgentTrace, kinds: readonly TraceKind[]): AgentTrace {
  if (kinds.length === 0 || kinds.length === traceKinds.length) {
    return trace;
  }
  const allowed = new Set(kinds);
  return { ...trace, events: trace.events.filter((event) => allowed.has(event.kind)) };
}

type TraceRepos = Pick<
  Repositories,
  "agentRuns" | "agentEvents" | "approvalRequests" | "auditEvents"
>;

export async function loadAgentTrace(
  repos: TraceRepos,
  runId: string,
  viewer: { actor: PolicyActor; authorizedPatientIds: string[] },
): Promise<AgentTrace | null> {
  const run = await repos.agentRuns.getById(runId);
  if (!run) {
    return null;
  }
  if (!viewer.authorizedPatientIds.includes(run.patientId)) {
    return null;
  }

  const [events, approvals, audits] = await Promise.all([
    repos.agentEvents.listByAgentRunId(run.id),
    repos.approvalRequests.listByAgentRunId(run.id),
    repos.auditEvents.listByAgentRunId(run.id),
  ]);

  return assembleTrace({ run, events, approvals, audits });
}

function mapAgentEvent(event: AgentEvent, toolCallAt: Map<string, Date>): TraceEvent | null {
  if (isRunTelemetryEvent(event)) {
    return null;
  }
  if (event.eventType === "think") {
    return {
      id: event.id,
      kind: "model_reasoning",
      at: event.timestamp,
      durationMs: null,
      actor: null,
      toolName: null,
      model: modelName(event.input) ?? "structured_model",
      outcome: "success",
      input: redactForTrace(event.input),
      output: redactForTrace(event.output),
    };
  }

  if (event.eventType === "tool_call") {
    if (event.toolName) {
      toolCallAt.set(event.toolName, event.timestamp);
    }
    return {
      id: event.id,
      kind: isContextTool(event.toolName) ? "context_requested" : "tool_called",
      at: event.timestamp,
      durationMs: null,
      actor: null,
      toolName: event.toolName,
      model: null,
      outcome: "pending",
      input: redactForTrace(event.input),
      output: null,
    };
  }

  if (event.eventType === "tool_result") {
    const started = event.toolName ? toolCallAt.get(event.toolName) : undefined;
    const ok = toolResultOk(event.output);
    return {
      id: event.id,
      kind: isKnowledgeTool(event.toolName) ? "knowledge_retrieved" : "tool_result",
      at: event.timestamp,
      durationMs: started ? durationMs(started, event.timestamp) : null,
      actor: null,
      toolName: event.toolName,
      model: null,
      outcome: ok ? "success" : "failure",
      input: redactForTrace(event.input),
      output: redactForTrace(event.output),
    };
  }

  if (event.eventType === "finish") {
    return {
      id: event.id,
      kind: "recommendation_generated",
      at: event.timestamp,
      durationMs: null,
      actor: null,
      toolName: null,
      model: "structured_model",
      outcome: "success",
      input: null,
      output: redactForTrace(event.output),
    };
  }

  if (event.eventType === "safety_review") {
    return {
      id: event.id,
      kind: "safety_review",
      at: event.timestamp,
      durationMs: null,
      actor: "safety_reviewer",
      toolName: null,
      model: null,
      outcome: safetyPassed(event.output) ? "success" : "failure",
      input: redactForTrace(event.input),
      output: redactForTrace(event.output),
    };
  }

  if (event.eventType === "policy_decision") {
    const human = humanDecisionPayload(event.output);
    if (!human) {
      return null;
    }
    return {
      id: event.id,
      kind: "human_decision",
      at: event.timestamp,
      durationMs: null,
      actor: human.actorId,
      toolName: null,
      model: null,
      outcome: human.decision === "rejected" ? "failure" : "success",
      input: redactForTrace(event.input),
      output: redactForTrace(event.output),
    };
  }

  if (event.eventType === "error") {
    return {
      id: event.id,
      kind: "model_reasoning",
      at: event.timestamp,
      durationMs: null,
      actor: null,
      toolName: event.toolName,
      model: "structured_model",
      outcome: "failure",
      input: redactForTrace(event.input),
      output: redactForTrace(event.output),
    };
  }

  return null;
}

function fillDurations(items: TraceEvent[]): void {
  for (let index = 1; index < items.length; index += 1) {
    const current = items[index];
    const previous = items[index - 1];
    if (!current || !previous || current.durationMs !== null) {
      continue;
    }
    current.durationMs = durationMs(previous.at, current.at);
  }
}

function durationMs(from: Date, to: Date): number | null {
  const ms = to.getTime() - from.getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

function modelName(input: unknown): string | null {
  if (input !== null && typeof input === "object" && "schemaName" in input) {
    const name = (input as { schemaName?: unknown }).schemaName;
    return typeof name === "string" ? name : null;
  }
  return null;
}

function toolResultOk(output: unknown): boolean {
  if (output !== null && typeof output === "object" && "ok" in output) {
    return (output as { ok?: unknown }).ok === true;
  }
  return true;
}

function safetyPassed(output: unknown): boolean {
  if (output === null || typeof output !== "object") {
    return true;
  }
  const record = output as { passed?: unknown; decision?: unknown };
  if (typeof record.passed === "boolean") {
    return record.passed;
  }
  if (typeof record.decision === "string") {
    return record.decision === "approved" || record.decision === "passed";
  }
  return true;
}

function humanDecisionPayload(output: unknown): {
  decision: string;
  pendingActionId?: string;
  actorId: string | null;
} | null {
  if (output === null || typeof output !== "object") {
    return null;
  }
  const record = output as {
    kind?: unknown;
    decision?: unknown;
    pendingActionId?: unknown;
    actorId?: unknown;
  };
  if (record.kind !== "human_decision" || typeof record.decision !== "string") {
    return null;
  }
  return {
    decision: record.decision,
    pendingActionId: typeof record.pendingActionId === "string" ? record.pendingActionId : undefined,
    actorId: typeof record.actorId === "string" ? record.actorId : null,
  };
}
