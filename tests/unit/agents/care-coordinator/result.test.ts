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

  it("keeps a single-document citation certain", () => {
    const secondChunk = "cite:kb_diabetes_followup:1";
    const check = validateCareCoordinatorResult(
      result({
        identifiedConcerns: [
          {
            title: "Follow-up window",
            description: "The fictional encounter mentioned an unplanned visit.",
            urgency: "medium",
            citationIds: [citationId, secondChunk],
          },
        ],
        confidence: 0.7,
      }),
      { retrievedCitationIds: new Set([citationId, secondChunk]) },
    );

    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.result.uncertainty.isUncertain).toBe(false);
      expect(check.result.confidence).toBe(0.7);
    }
  });

  it("marks a finish uncertain when it cites more than one document", () => {
    const other = "cite:kb_diabetes_hypoglycemia:0";
    const check = validateCareCoordinatorResult(
      result({
        identifiedConcerns: [
          {
            title: "No coordination needed",
            description: "Diabetes follow-up and hypoglycemia cards cancel each other out.",
            urgency: "none",
            citationIds: [citationId, other],
          },
        ],
        confidence: 0.88,
      }),
      { retrievedCitationIds: new Set([citationId, other]) },
    );

    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.result.uncertainty.isUncertain).toBe(true);
      expect(check.result.confidence).toBeLessThanOrEqual(0.4);
      expect(check.notes.join(" ")).toMatch(/conflict/i);
    }
  });
});
