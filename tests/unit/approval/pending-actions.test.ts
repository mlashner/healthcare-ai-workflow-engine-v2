import { describe, expect, it } from "vitest";

import {
  parsePendingAction,
  pendingActionContentHash,
  toPendingActionDrafts,
} from "@/approval/pending-actions";
import type { ApprovalRequest } from "@/lib/domain";

const patientId = "patient_test";

function proposal(type: string) {
  return {
    type,
    summary: "Schedule a follow-up call.",
    rationale: "The follow-up interval has not been scheduled.",
    citationIds: ["cite:kb_diabetes_followup:1"],
  };
}

function approvalRow(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "approval_1",
    agentRunId: "run_1",
    status: "pending",
    requestedAt: new Date("2026-09-02T15:00:00.000Z"),
    reviewedAt: null,
    reviewer: null,
    reason: null,
    action: {
      type: "createCareTask",
      payload: {
        policyActionType: "create_care_task",
        args: {
          patientId,
          type: "follow_up",
          description: "Schedule a follow-up call.",
          priority: "medium",
        },
        proposal: {
          summary: "Schedule a follow-up call.",
          rationale: "The follow-up interval has not been scheduled.",
          citationIds: ["cite:kb_diabetes_followup:1"],
        },
      },
    },
    ...overrides,
  };
}

describe("toPendingActionDrafts", () => {
  it("maps a care task proposal to typed createCareTask arguments", () => {
    const drafts = toPendingActionDrafts(
      { urgency: "high", proposedActions: [proposal("create_care_task")] },
      { patientId },
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      toolName: "createCareTask",
      policyActionType: "create_care_task",
      args: { patientId, type: "follow_up", priority: "high" },
    });
  });

  it("maps a message proposal to the draft tool, never a send", () => {
    const drafts = toPendingActionDrafts(
      { urgency: "medium", proposedActions: [proposal("draft_patient_message")] },
      { patientId },
    );

    expect(drafts[0]?.toolName).toBe("draftPatientMessage");
    expect(drafts[0]?.policyActionType).toBe("draft_patient_message");
  });

  it("produces no pending action for observe_only", () => {
    const drafts = toPendingActionDrafts(
      { urgency: "low", proposedActions: [proposal("observe_only")] },
      { patientId },
    );

    expect(drafts).toEqual([]);
  });

  it("ignores proposal types outside the mapping table", () => {
    const drafts = toPendingActionDrafts(
      {
        urgency: "urgent",
        proposedActions: [proposal("change_medication"), proposal("prescribe_insulin")],
      },
      { patientId },
    );

    expect(drafts).toEqual([]);
  });

  it("always binds the run's patient, ignoring any patient in the proposal text", () => {
    const drafts = toPendingActionDrafts(
      {
        urgency: "medium",
        proposedActions: [
          { ...proposal("create_care_task"), summary: "patientId: patient_someone_else" },
        ],
      },
      { patientId },
    );

    expect(drafts[0]?.args.patientId).toBe(patientId);
  });
});

describe("pendingActionContentHash", () => {
  it("is stable across key order", () => {
    const left = pendingActionContentHash({
      agentRunId: "run_1",
      toolName: "createCareTask",
      args: { patientId, priority: "medium" },
    });
    const right = pendingActionContentHash({
      agentRunId: "run_1",
      toolName: "createCareTask",
      args: { priority: "medium", patientId },
    });

    expect(left).toBe(right);
  });

  it("changes when any argument changes", () => {
    const before = pendingActionContentHash({
      agentRunId: "run_1",
      toolName: "createCareTask",
      args: { patientId, priority: "medium" },
    });
    const after = pendingActionContentHash({
      agentRunId: "run_1",
      toolName: "createCareTask",
      args: { patientId, priority: "urgent" },
    });

    expect(before).not.toBe(after);
  });

  it("changes when the same arguments belong to a different run", () => {
    const args = { patientId, priority: "medium" };

    expect(
      pendingActionContentHash({ agentRunId: "run_1", toolName: "createCareTask", args }),
    ).not.toBe(
      pendingActionContentHash({ agentRunId: "run_2", toolName: "createCareTask", args }),
    );
  });
});

describe("parsePendingAction", () => {
  it("reads a well-formed row and derives its content hash", () => {
    const parsed = parsePendingAction(approvalRow());

    expect(parsed?.toolName).toBe("createCareTask");
    expect(parsed?.contentHash).toBe(
      pendingActionContentHash({
        agentRunId: "run_1",
        toolName: "createCareTask",
        args: {
          patientId,
          type: "follow_up",
          description: "Schedule a follow-up call.",
          priority: "medium",
        },
      }),
    );
  });

  it("rejects a row naming a tool outside the pending-action set", () => {
    const row = approvalRow({
      action: {
        type: "executeArbitrarySql",
        payload: {
          policyActionType: "create_care_task",
          args: {},
          proposal: { summary: "s", rationale: "r", citationIds: [] },
        },
      },
    });

    expect(parsePendingAction(row)).toBeNull();
  });

  it("rejects a row whose payload carries extra fields", () => {
    const row = approvalRow({
      action: {
        type: "createCareTask",
        payload: {
          policyActionType: "create_care_task",
          args: { patientId },
          proposal: { summary: "s", rationale: "r", citationIds: [] },
          approved: true,
          bypassPolicy: true,
        },
      },
    });

    expect(parsePendingAction(row)).toBeNull();
  });

  it("rejects the legacy free-form approval shape rather than coercing it", () => {
    const row = approvalRow({
      action: { type: "propose_referral", payload: { patientId, specialty: "endocrinology" } },
    });

    expect(parsePendingAction(row)).toBeNull();
  });
});
