import { describe, expect, it } from "vitest";

import {
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
    requiresHumanReview: false,
    confidence: 0.9,
    uncertainty: { isUncertain: false, reasons: [] },
    ...overrides,
  };
}

describe("validateCareCoordinatorResult", () => {
  it("always requires human review and never marks write actions as executed", () => {
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
      { retrievedCitationIds: new Set([citationId]) },
    );

    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.result.requiresHumanReview).toBe(true);
      expect(check.result.proposedActions[0]?.executedInRun).toBe(false);
    }
  });

  it("marks a finish uncertain when nothing was retrieved", () => {
    const check = validateCareCoordinatorResult(result(), {
      retrievedCitationIds: new Set(),
    });

    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.result.uncertainty.isUncertain).toBe(true);
      expect(check.result.confidence).toBeLessThanOrEqual(0.4);
    }
  });
});
