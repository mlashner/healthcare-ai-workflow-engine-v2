import { describe, expect, it } from "vitest";

import {
  containsDiagnosisClaim,
  validateCareCoordinatorResult,
  type CareCoordinatorResult,
} from "@/agents/care-coordinator";

const citationId = "cite:kb_diabetes_followup:0";

function result(overrides: Partial<CareCoordinatorResult> = {}): CareCoordinatorResult {
  return {
    summary: "Fictional coordination review. Not a diagnosis.",
    identifiedConcerns: [],
    urgency: "none",
    reasoning: "No coordination issue can be confirmed from retrieved evidence.",
    evidence: [],
    proposedActions: [],
    requiresHumanReview: true,
    confidence: 0.2,
    uncertainty: { isUncertain: true, reasons: ["Thin evidence."] },
    ...overrides,
  };
}

describe("containsDiagnosisClaim", () => {
  it("flags first-person diagnosis language and ignores refusals", () => {
    expect(containsDiagnosisClaim("I diagnose new diabetes.")).toBe(true);
    expect(containsDiagnosisClaim("This is not a diagnosis. Surface the gap to a human.")).toBe(
      false,
    );
  });
});

describe("validateCareCoordinatorResult", () => {
  it("rejects clinical claims that lack retrieved citations", () => {
    const check = validateCareCoordinatorResult(
      result({
        identifiedConcerns: [
          {
            title: "Follow-up gap",
            description: "The fictional visit may need coordination.",
            urgency: "medium",
            citationIds: [],
          },
        ],
        uncertainty: { isUncertain: false, reasons: [] },
        confidence: 0.9,
      }),
      { retrievedCitationIds: new Set(), successfulTools: [] },
    );

    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.issues.join(" ")).toMatch(/citation/i);
    }
  });

  it("rejects fabricated citation IDs", () => {
    const check = validateCareCoordinatorResult(
      result({
        identifiedConcerns: [
          {
            title: "Follow-up gap",
            description: "The fictional visit may need coordination.",
            urgency: "medium",
            citationIds: ["cite:kb_invented:0"],
          },
        ],
      }),
      { retrievedCitationIds: new Set([citationId]), successfulTools: [] },
    );

    expect(check.ok).toBe(false);
  });

  it("rejects diagnosis claims", () => {
    const check = validateCareCoordinatorResult(
      result({ summary: "I diagnose hypertension in this fictional patient." }),
      { retrievedCitationIds: new Set(), successfulTools: [] },
    );
    expect(check.ok).toBe(false);
  });

  it("keeps retrieved evidence distinct from inference and overlays uncertainty", () => {
    const check = validateCareCoordinatorResult(
      result({
        identifiedConcerns: [
          {
            title: "Follow-up window",
            description: "Unplanned visit follow-up may still be open.",
            urgency: "medium",
            citationIds: [citationId],
          },
        ],
        evidence: [
          {
            kind: "retrieved",
            text: "Demo snippet about follow-up after an unplanned visit.",
            citationId,
            toolName: "searchClinicalKnowledge",
          },
          {
            kind: "inferred",
            text: "A human should confirm whether outreach is still needed.",
          },
        ],
        urgency: "medium",
        confidence: 0.8,
        uncertainty: { isUncertain: false, reasons: [] },
        requiresHumanReview: false,
      }),
      {
        retrievedCitationIds: new Set([citationId]),
        successfulTools: ["searchClinicalKnowledge", "createCareTask"],
      },
    );

    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.result.evidence[0]?.kind).toBe("retrieved");
      expect(check.result.evidence[1]?.kind).toBe("inferred");
      expect(check.result.requiresHumanReview).toBe(true);
      expect(check.result.proposedActions).toEqual([]);
    }
  });

  it("never marks write actions as executed during the agent loop", () => {
    const check = validateCareCoordinatorResult(
      result({
        proposedActions: [
          {
            type: "create_care_task",
            summary: "Draft a follow-up.",
            rationale: "Human review required.",
            citationIds: [citationId],
            executedInRun: true,
          },
        ],
      }),
      { retrievedCitationIds: new Set([citationId]), successfulTools: ["createCareTask"] },
    );

    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.result.proposedActions[0]?.executedInRun).toBe(false);
    }
  });

  it("marks a finish uncertain when nothing was retrieved", () => {
    const check = validateCareCoordinatorResult(
      result({
        confidence: 0.9,
        uncertainty: { isUncertain: false, reasons: [] },
      }),
      { retrievedCitationIds: new Set(), successfulTools: [] },
    );

    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.result.uncertainty.isUncertain).toBe(true);
      expect(check.result.confidence).toBeLessThanOrEqual(0.4);
    }
  });
});
