import { describe, expect, it } from "vitest";

import {
  createAgentEventSchema,
  createAgentRunSchema,
  createApprovalRequestSchema,
  createCareTaskSchema,
  createClinicalDocumentSchema,
  createEncounterSchema,
  createPatientSchema,
  createProviderSchema,
  isoDateSchema,
  updateApprovalRequestSchema,
  updateCareTaskSchema,
  updatePatientSchema,
} from "@/lib/domain";

describe("isoDateSchema", () => {
  it("accepts a real calendar date", () => {
    expect(isoDateSchema.parse("1978-06-21")).toBe("1978-06-21");
  });

  it("rejects a non-ISO value", () => {
    expect(() => isoDateSchema.parse("06/21/1978")).toThrow(/YYYY-MM-DD/);
  });

  it("rejects an impossible calendar date", () => {
    expect(() => isoDateSchema.parse("2024-02-30")).toThrow(/invalid calendar date/);
  });
});

describe("createPatientSchema", () => {
  it("accepts a fictional patient and defaults list fields", () => {
    const patient = createPatientSchema.parse({
      name: "Ava Nguyen (FICTIONAL)",
      dateOfBirth: "1978-06-21",
    });

    expect(patient.conditions).toEqual([]);
    expect(patient.medications).toEqual([]);
  });

  it("accepts structured conditions and medications", () => {
    const patient = createPatientSchema.parse({
      name: "Marcus Hale (FICTIONAL)",
      dateOfBirth: "1991-11-03",
      conditions: [{ name: "Asthma", notes: "Fictional" }],
      medications: [{ name: "albuterol", dosage: "90 mcg", frequency: "as needed" }],
    });

    expect(patient.conditions[0]?.name).toBe("Asthma");
    expect(patient.medications[0]?.name).toBe("albuterol");
  });

  it("rejects an empty name", () => {
    expect(() =>
      createPatientSchema.parse({ name: "", dateOfBirth: "1978-06-21" }),
    ).toThrow();
  });

  it("rejects a missing date of birth", () => {
    expect(() => createPatientSchema.parse({ name: "Ava Nguyen (FICTIONAL)" })).toThrow();
  });
});

describe("updatePatientSchema", () => {
  it("allows a partial update", () => {
    expect(updatePatientSchema.parse({ name: "Ava N. (FICTIONAL)" })).toEqual({
      name: "Ava N. (FICTIONAL)",
    });
  });
});

describe("createProviderSchema", () => {
  it("accepts a known role", () => {
    expect(
      createProviderSchema.parse({
        name: "Dr. Elena Vargas (FICTIONAL)",
        role: "physician",
      }),
    ).toMatchObject({ role: "physician" });
  });

  it("rejects an unknown role", () => {
    expect(() =>
      createProviderSchema.parse({
        name: "Someone",
        role: "admin",
      }),
    ).toThrow();
  });
});

describe("createEncounterSchema", () => {
  it("requires a transcript and both foreign keys", () => {
    const encounter = createEncounterSchema.parse({
      patientId: "patient_fictional_ava",
      providerId: "provider_fictional_vargas",
      transcript: "FICTIONAL ENCOUNTER",
    });

    expect(encounter.transcript).toContain("FICTIONAL");
  });

  it("rejects an empty transcript", () => {
    expect(() =>
      createEncounterSchema.parse({
        patientId: "patient_fictional_ava",
        providerId: "provider_fictional_vargas",
        transcript: "",
      }),
    ).toThrow();
  });
});

describe("createClinicalDocumentSchema", () => {
  it("defaults version and requires a known source", () => {
    const document = createClinicalDocumentSchema.parse({
      title: "Fictional diabetes follow-up interval",
      content: "DEMO ONLY",
      source: "guideline",
    });

    expect(document.version).toBe("1");
  });

  it("rejects an unknown source", () => {
    expect(() =>
      createClinicalDocumentSchema.parse({
        title: "Note",
        content: "DEMO ONLY",
        source: "pubmed",
      }),
    ).toThrow();
  });
});

describe("createCareTaskSchema", () => {
  it("defaults status and priority", () => {
    const task = createCareTaskSchema.parse({
      patientId: "patient_fictional_ava",
      type: "follow_up",
      description: "Fictional follow-up",
    });

    expect(task.status).toBe("draft");
    expect(task.priority).toBe("medium");
  });

  it("rejects an unknown task type", () => {
    expect(() =>
      createCareTaskSchema.parse({
        patientId: "patient_fictional_ava",
        type: "prescribe",
        description: "not allowed",
      }),
    ).toThrow();
  });
});

describe("updateCareTaskSchema", () => {
  it("accepts a status-only change", () => {
    expect(updateCareTaskSchema.parse({ status: "pending_approval" })).toEqual({
      status: "pending_approval",
    });
  });
});

describe("createAgentRunSchema", () => {
  it("defaults status to queued", () => {
    const run = createAgentRunSchema.parse({
      patientId: "patient_fictional_ava",
      agentName: "care_coordinator",
    });

    expect(run.status).toBe("queued");
  });
});

describe("createAgentEventSchema", () => {
  it("accepts a tool call with structured input", () => {
    const event = createAgentEventSchema.parse({
      agentRunId: "run_fictional_ava_coordinator",
      eventType: "tool_call",
      toolName: "retrieve_patient_context",
      input: { patientId: "patient_fictional_ava" },
    });

    expect(event.toolName).toBe("retrieve_patient_context");
  });

  it("rejects an unknown event type", () => {
    expect(() =>
      createAgentEventSchema.parse({
        agentRunId: "run_1",
        eventType: "sql_query",
      }),
    ).toThrow();
  });
});

describe("createApprovalRequestSchema", () => {
  it("defaults a pending request and action payload", () => {
    const request = createApprovalRequestSchema.parse({
      agentRunId: "run_fictional_ava_coordinator",
      action: { type: "propose_referral" },
    });

    expect(request.status).toBe("pending");
    expect(request.action.payload).toEqual({});
  });

  it("rejects a missing action type", () => {
    expect(() =>
      createApprovalRequestSchema.parse({
        agentRunId: "run_1",
        action: { payload: {} },
      }),
    ).toThrow();
  });
});

describe("updateApprovalRequestSchema", () => {
  it("accepts a reviewer decision without treating it as authorization logic", () => {
    expect(
      updateApprovalRequestSchema.parse({
        status: "approved",
        reviewer: "Chris Patel (FICTIONAL)",
        reason: "Fictional demo approval",
        reviewedAt: new Date("2026-08-28T17:00:00.000Z"),
      }),
    ).toMatchObject({ status: "approved" });
  });
});
