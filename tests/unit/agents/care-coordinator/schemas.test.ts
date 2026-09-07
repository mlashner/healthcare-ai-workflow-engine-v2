import { describe, expect, it } from "vitest";

import {
  careCoordinatorResultSchema,
  careCoordinatorStepSchema,
} from "@/agents/care-coordinator";

const validResult = {
  summary: "Fictional coordination review. Not a diagnosis.",
  identifiedConcerns: [],
  urgency: "none" as const,
  reasoning: "Evidence is insufficient.",
  evidence: [],
  proposedActions: [],
  requiresHumanReview: true,
  confidence: 0.2,
  uncertainty: { isUncertain: true, reasons: ["No retrieved snippets."] },
};

describe("careCoordinatorResultSchema", () => {
  it("accepts a complete finish payload", () => {
    expect(careCoordinatorResultSchema.parse(validResult).uncertainty.isUncertain).toBe(true);
  });

  it("rejects extra keys and missing required fields", () => {
    expect(() =>
      careCoordinatorResultSchema.parse({ ...validResult, skipApproval: true }),
    ).toThrow();
    expect(() =>
      careCoordinatorResultSchema.parse({
        ...validResult,
        identifiedConcerns: undefined,
      }),
    ).toThrow();
  });
});

describe("careCoordinatorStepSchema", () => {
  it("accepts think, tool_call, and finish only", () => {
    expect(careCoordinatorStepSchema.parse({ type: "think", thought: "read the chart" })).toEqual({
      type: "think",
      thought: "read the chart",
    });
    expect(
      careCoordinatorStepSchema.parse({
        type: "tool_call",
        toolName: "getPatientContext",
        arguments: { patientId: "patient_fictional_ava" },
      }).type,
    ).toBe("tool_call");
    expect(
      careCoordinatorStepSchema.parse({ type: "finish", result: validResult }).type,
    ).toBe("finish");
  });

  it("rejects free-text tool calls and unknown step types", () => {
    expect(() =>
      careCoordinatorStepSchema.parse("call getPatientContext now"),
    ).toThrow();
    expect(() =>
      careCoordinatorStepSchema.parse({ type: "execute", toolName: "getPatientContext" }),
    ).toThrow();
  });
});
