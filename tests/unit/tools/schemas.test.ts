import { describe, expect, it } from "vitest";

import {
  createCareTaskInputSchema,
  getPatientContextInputSchema,
  requestHumanApprovalInputSchema,
  searchClinicalKnowledgeInputSchema,
} from "@/tools/schemas";

describe("tool input schemas", () => {
  it("rejects privilege-widening fields on getPatientContext", () => {
    const result = getPatientContextInputSchema.safeParse({
      patientId: "patient_fictional_ava",
      skipApproval: true,
      role: "admin",
      authorized: true,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a status field on createCareTask so the model cannot self-approve", () => {
    const result = createCareTaskInputSchema.safeParse({
      patientId: "patient_fictional_ava",
      type: "referral",
      description: "Fictional",
      status: "approved",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unknown approval action type", () => {
    const result = requestHumanApprovalInputSchema.safeParse({
      actionType: "execute_sql",
      payload: { patientId: "patient_fictional_ava" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a short knowledge query", () => {
    expect(searchClinicalKnowledgeInputSchema.safeParse({ query: "a" }).success).toBe(false);
  });
});
