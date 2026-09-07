import { describe, expect, it } from "vitest";

import type { AgentEvent, AgentRun, ApprovalRequest, AuditEvent } from "@/lib/domain";
import { assembleTrace, filterTrace } from "@/trace/assemble";
import { redactForTrace } from "@/trace/redact";

const run: AgentRun = {
  id: "run_trace",
  patientId: "patient_bound",
  agentName: "care_coordinator",
  status: "completed",
  startedAt: new Date("2026-09-02T15:00:00.000Z"),
  completedAt: new Date("2026-09-02T15:00:20.000Z"),
};

function event(overrides: Partial<AgentEvent> & Pick<AgentEvent, "id" | "eventType">): AgentEvent {
  return {
    agentRunId: run.id,
    toolName: null,
    input: null,
    output: null,
    timestamp: new Date("2026-09-02T15:00:01.000Z"),
    ...overrides,
  };
}

describe("redactForTrace", () => {
  it("redacts secrets and chart demographics, not model reasoning text", () => {
    const redacted = redactForTrace({
      apiKey: "sk-live-not-a-real-key",
      name: "Ava Nguyen (FICTIONAL)",
      transcript: "secret visit text",
      thought: "Gather chart context.",
      summary: "Follow-up may be needed.",
      patientId: "patient_bound",
    });

    expect(redacted).toEqual({
      apiKey: "[redacted]",
      name: "[redacted]",
      transcript: "[redacted]",
      thought: "Gather chart context.",
      summary: "Follow-up may be needed.",
      patientId: "patient_bound",
    });
  });
});

describe("assembleTrace", () => {
  it("projects a complete run onto the twelve clinician-facing kinds in time order", () => {
    const events: AgentEvent[] = [
      event({
        id: "e_think",
        eventType: "think",
        input: { kind: "model_invocation", schemaName: "CareCoordinatorStep" },
        output: { thought: "Look up context." },
        timestamp: new Date("2026-09-02T15:00:01.000Z"),
      }),
      event({
        id: "e_ctx_call",
        eventType: "tool_call",
        toolName: "getPatientContext",
        input: { patientId: "patient_bound", name: "Ava Nguyen (FICTIONAL)" },
        timestamp: new Date("2026-09-02T15:00:02.000Z"),
      }),
      event({
        id: "e_ctx_result",
        eventType: "tool_result",
        toolName: "getPatientContext",
        output: { ok: true, output: { name: "Ava Nguyen (FICTIONAL)", patientId: "patient_bound" } },
        timestamp: new Date("2026-09-02T15:00:03.000Z"),
      }),
      event({
        id: "e_kb_call",
        eventType: "tool_call",
        toolName: "searchClinicalKnowledge",
        input: { query: "follow-up" },
        timestamp: new Date("2026-09-02T15:00:04.000Z"),
      }),
      event({
        id: "e_kb_result",
        eventType: "tool_result",
        toolName: "searchClinicalKnowledge",
        output: { ok: true, output: { results: [{ relevantText: "passage", citationId: "cite:kb:1" }] } },
        timestamp: new Date("2026-09-02T15:00:06.000Z"),
      }),
      event({
        id: "e_write_call",
        eventType: "tool_call",
        toolName: "createCareTask",
        input: { patientId: "patient_bound", description: "Follow up." },
        timestamp: new Date("2026-09-02T15:00:07.000Z"),
      }),
      event({
        id: "e_write_result",
        eventType: "tool_result",
        toolName: "createCareTask",
        output: { ok: false, error: { code: "POLICY_DENIED", message: "cannot execute during the agent loop" } },
        timestamp: new Date("2026-09-02T15:00:07.050Z"),
      }),
      event({
        id: "e_finish",
        eventType: "finish",
        output: { summary: "Propose a follow-up task." },
        timestamp: new Date("2026-09-02T15:00:08.000Z"),
      }),
      event({
        id: "e_safety",
        eventType: "safety_review",
        output: { passed: true, issues: [] },
        timestamp: new Date("2026-09-02T15:00:09.000Z"),
      }),
      event({
        id: "e_human",
        eventType: "policy_decision",
        output: {
          kind: "human_decision",
          decision: "approved",
          pendingActionId: "approval_1",
          actorId: "provider_blake",
        },
        timestamp: new Date("2026-09-02T15:00:16.000Z"),
      }),
    ];

    const approvals: ApprovalRequest[] = [
      {
        id: "approval_1",
        agentRunId: run.id,
        status: "approved",
        requestedAt: new Date("2026-09-02T15:00:10.000Z"),
        reviewedAt: new Date("2026-09-02T15:00:16.000Z"),
        reviewer: "provider_blake",
        reason: null,
        action: {
          type: "createCareTask",
          payload: {
            policyActionType: "create_care_task",
            args: { patientId: "patient_bound", type: "follow_up", description: "Follow up.", priority: "medium" },
            proposal: { summary: "Schedule follow-up.", rationale: "Interval lapsed.", citationIds: [] },
          },
        },
      },
    ];

    const audits: AuditEvent[] = [
      {
        id: "audit_policy",
        agentRunId: run.id,
        toolName: "create_care_task",
        outcome: "policy_allowed",
        code: "policy.care_task.create",
        message: "allowed",
        actorId: "provider_blake",
        agentName: "care_coordinator",
        patientScope: "patient_bound",
        input: { type: "create_care_task", patientId: "patient_bound" },
        details: { allowed: true },
        createdAt: new Date("2026-09-02T15:00:15.000Z"),
      },
      {
        id: "audit_exec",
        agentRunId: run.id,
        toolName: "createCareTask",
        outcome: "executed",
        code: "OK",
        message: "tool executed",
        actorId: "provider_blake",
        agentName: "care_coordinator",
        patientScope: "patient_bound",
        input: { patientId: "patient_bound", description: "Follow up." },
        details: null,
        createdAt: new Date("2026-09-02T15:00:17.000Z"),
      },
      {
        id: "audit_read",
        agentRunId: run.id,
        toolName: "getPatientContext",
        outcome: "executed",
        code: "OK",
        message: "tool executed",
        actorId: "provider_blake",
        agentName: "care_coordinator",
        patientScope: "patient_bound",
        input: { patientId: "patient_bound" },
        details: null,
        createdAt: new Date("2026-09-02T15:00:03.000Z"),
      },
    ];

    const trace = assembleTrace({ run, events, approvals, audits });
    const kinds = trace.events.map((item) => item.kind);

    expect(kinds).toEqual([
      "agent_started",
      "model_reasoning",
      "context_requested",
      "tool_result",
      "tool_called",
      "knowledge_retrieved",
      "tool_called",
      "tool_result",
      "recommendation_generated",
      "safety_review",
      "approval_requested",
      "policy_evaluation",
      "human_decision",
      "action_executed",
    ]);

    const knowledge = trace.events.find((item) => item.kind === "knowledge_retrieved");
    expect(knowledge?.durationMs).toBe(2000);
    expect(JSON.stringify(knowledge?.output)).not.toContain("passage");

    const contextCall = trace.events.find((item) => item.kind === "context_requested");
    expect(JSON.stringify(contextCall?.input)).not.toContain("Ava Nguyen");
    expect(JSON.stringify(contextCall?.input)).toContain("[redacted]");

    const writeResult = trace.events.find(
      (item) => item.kind === "tool_result" && item.toolName === "createCareTask",
    );
    expect(writeResult?.outcome).toBe("failure");

    expect(trace.events.filter((item) => item.kind === "action_executed")).toHaveLength(1);
    expect(trace.events.filter((item) => item.kind === "human_decision")).toHaveLength(1);
  });

  it("filters by event type without dropping neighboring kinds", () => {
    const trace = assembleTrace({
      run,
      events: [
        event({
          id: "e_finish",
          eventType: "finish",
          output: { summary: "ok" },
          timestamp: new Date("2026-09-02T15:00:08.000Z"),
        }),
      ],
      approvals: [],
      audits: [],
    });

    const filtered = filterTrace(trace, ["recommendation_generated"]);
    expect(filtered.events.map((item) => item.kind)).toEqual(["recommendation_generated"]);
  });
});
