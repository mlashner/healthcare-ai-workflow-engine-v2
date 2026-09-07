import { describe, expect, it, vi } from "vitest";

import type { ToolInvocationContext } from "@/authz/types";
import type { CareTask, CreateApprovalRequest, Patient } from "@/lib/domain";
import { createGetPatientContextTool } from "@/tools/definitions";
import {
  createCareTaskService,
  createHumanApprovalService,
  createPatientContextService,
} from "@/tools/services";

const context: ToolInvocationContext = {
  actor: { id: "actor_1", role: "care_coordinator" },
  agentName: "care_coordinator",
  patientScope: "patient_in_scope",
  agentRunId: "run_1",
};

const patient: Patient = {
  id: "patient_in_scope",
  name: "In Scope (FICTIONAL)",
  dateOfBirth: "1980-01-01",
  conditions: [{ name: "Asthma" }],
  medications: [],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("tool services", () => {
  it("loads patient context from the bound scope, not the argument", async () => {
    const getById = vi.fn(async (id: string) => (id === patient.id ? patient : null));
    const tool = createGetPatientContextTool({ getById });

    const output = await tool.execute({ patientId: "patient_other" }, context);

    expect(getById).toHaveBeenCalledWith("patient_in_scope");
    expect(output.patientId).toBe("patient_in_scope");
    expect(output.conditions).toEqual([{ name: "Asthma" }]);
  });

  it("returns NOT_FOUND when the scoped patient is missing", async () => {
    const service = createPatientContextService({ getById: async () => null });

    await expect(service.execute({ patientId: "patient_in_scope" }, context)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("creates care tasks as draft regardless of caller intent", async () => {
    const create = vi.fn(async (input: { status?: string; patientId: string }) => {
      return {
        id: "task_1",
        patientId: input.patientId,
        type: "referral",
        description: "Fictional",
        priority: "high",
        status: input.status ?? "draft",
        assignedTo: null,
        createdAt: new Date(),
      } as CareTask;
    });

    const output = await createCareTaskService({
      create,
      listByPatientId: async () => [],
    }).execute(
      {
        patientId: "patient_other",
        type: "referral",
        description: "Fictional",
        priority: "high",
      },
      context,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: "patient_in_scope",
        status: "draft",
      }),
    );
    expect(output.status).toBe("draft");
  });

  it("records approvals as pending and rebinds payload.patientId to scope", async () => {
    const create = vi.fn(async (input: CreateApprovalRequest) => ({
      id: "approval_1",
      agentRunId: "run_1",
      action: { type: "propose_referral" as const, payload: input.action.payload ?? {} },
      status: "pending" as const,
      requestedAt: new Date(),
      reviewedAt: null,
      reviewer: null,
      reason: null,
    }));

    const output = await createHumanApprovalService({ create }).execute(
      {
        actionType: "propose_referral",
        payload: { patientId: "patient_other", specialty: "endocrinology" },
      },
      context,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        action: {
          type: "propose_referral",
          payload: { patientId: "patient_in_scope", specialty: "endocrinology" },
        },
      }),
    );
    expect(output.status).toBe("pending");
    expect(output.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
