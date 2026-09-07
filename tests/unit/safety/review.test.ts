import { describe, expect, it } from "vitest";

import type { CareCoordinatorResult } from "@/agents/care-coordinator";
import { containsDiagnosisClaim, reviewCareCoordinatorSafety } from "@/safety";

const citationId = "cite:kb_diabetes_followup:0";
const snippet = {
  citationId,
  text: "Follow up after an unplanned visit.",
};

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
  it("flags paraphrase diagnosis language and ignores refusals", () => {
    expect(containsDiagnosisClaim("The presentation is consistent with new-onset diabetes.")).toBe(
      true,
    );
    expect(containsDiagnosisClaim("This is not a diagnosis. Surface the gap to a human.")).toBe(
      false,
    );
  });
});

describe("reviewCareCoordinatorSafety", () => {
  it("rejects clinical claims that lack retrieved citations", () => {
    const review = reviewCareCoordinatorSafety(
      result({
        identifiedConcerns: [
          {
            title: "Follow-up gap",
            description: "The fictional visit may need coordination.",
            urgency: "medium",
            citationIds: [],
          },
        ],
      }),
      { retrievedSnippets: [] },
    );
    expect(review.passed).toBe(false);
    expect(review.requiresHumanReview).toBe(true);
  });

  it("rejects a cited claim that the snippet does not support", () => {
    const review = reviewCareCoordinatorSafety(
      result({
        identifiedConcerns: [
          {
            title: "Cardiac escalation",
            description: "The patient needs urgent heart failure referral and insulin.",
            urgency: "urgent",
            citationIds: [citationId],
          },
        ],
      }),
      { retrievedSnippets: [snippet] },
    );
    expect(review.passed).toBe(false);
    expect(review.issues.join(" ")).toMatch(/not supported/i);
  });

  it("accepts a claim that overlaps the retrieved snippet", () => {
    const review = reviewCareCoordinatorSafety(
      result({
        identifiedConcerns: [
          {
            title: "Follow-up window",
            description: "The fictional encounter mentioned an unplanned visit.",
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
        ],
      }),
      { retrievedSnippets: [snippet] },
    );
    expect(review.passed).toBe(true);
  });
});
