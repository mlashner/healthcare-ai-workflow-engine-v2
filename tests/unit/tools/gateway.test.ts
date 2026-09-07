import { describe, expect, it, vi } from "vitest";

import { createInMemoryAuditWriter } from "@/audit/writer";
import type { ToolInvocationContext } from "@/authz/types";
import type { Patient } from "@/lib/domain";
import { createGetPatientContextTool, createCreateCareTaskTool } from "@/tools/definitions";
import { createToolGateway } from "@/tools/gateway";
import { ToolRegistry } from "@/tools/registry";

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
  conditions: [],
  medications: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("tool gateway", () => {
  it("does not execute when arguments request another patient", async () => {
    const getById = vi.fn(async () => patient);
    const audit = createInMemoryAuditWriter();
    const gateway = createToolGateway({
      registry: new ToolRegistry().register(createGetPatientContextTool({ getById })),
      audit,
    });

    const result = await gateway.invoke(
      "getPatientContext",
      { patientId: "patient_other" },
      context,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHORIZED");
    }
    expect(getById).not.toHaveBeenCalled();
    expect(audit.events[0]).toMatchObject({
      outcome: "denied",
      code: "UNAUTHORIZED",
      patientScope: "patient_in_scope",
    });
  });

  it("rejects skipApproval and other extra fields before authorization or execution", async () => {
    const getById = vi.fn(async () => patient);
    const audit = createInMemoryAuditWriter();
    const gateway = createToolGateway({
      registry: new ToolRegistry().register(createGetPatientContextTool({ getById })),
      audit,
    });

    const result = await gateway.invoke(
      "getPatientContext",
      {
        patientId: "patient_in_scope",
        skipApproval: true,
        authorized: true,
        role: "admin",
      },
      context,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
    expect(getById).not.toHaveBeenCalled();
    expect(audit.events[0]?.outcome).toBe("validation_error");
  });

  it("does not let a safety reviewer create a care task", async () => {
    const create = vi.fn();
    const audit = createInMemoryAuditWriter();
    const gateway = createToolGateway({
      registry: new ToolRegistry().register(
        createCreateCareTaskTool({
          create,
          listByPatientId: async () => [],
        }),
      ),
      audit,
    });

    const result = await gateway.invoke(
      "createCareTask",
      {
        patientId: "patient_in_scope",
        type: "follow_up",
        description: "should be denied",
      },
      { ...context, agentName: "safety_reviewer" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("POLICY_DENIED");
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("executes an authorized in-scope read and audits success", async () => {
    const getById = vi.fn(async () => patient);
    const audit = createInMemoryAuditWriter();
    const gateway = createToolGateway({
      registry: new ToolRegistry().register(createGetPatientContextTool({ getById })),
      audit,
    });

    const result = await gateway.invoke(
      "getPatientContext",
      { patientId: "patient_in_scope" },
      context,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toMatchObject({ patientId: "patient_in_scope" });
    }
    expect(getById).toHaveBeenCalledTimes(1);
    expect(audit.events[0]?.outcome).toBe("executed");
  });

  it("returns a structured error for an unknown tool", async () => {
    const audit = createInMemoryAuditWriter();
    const gateway = createToolGateway({
      registry: new ToolRegistry(),
      audit,
    });

    const result = await gateway.invoke("dropDatabase", {}, context);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNKNOWN_TOOL");
    }
    expect(audit.events[0]?.outcome).toBe("unknown_tool");
  });
});
