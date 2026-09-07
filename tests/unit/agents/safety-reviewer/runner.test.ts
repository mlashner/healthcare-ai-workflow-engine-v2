import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createSafetyReviewer } from "@/agents/safety-reviewer";
import type { SafetyReviewerRunInput } from "@/agents/safety-reviewer";
import { bindRunSession, createInMemoryEventStore, createInMemoryRunStore } from "@/runs";

const patientId = "patient_in_scope";
const citationId = "cite:kb_diabetes_followup:0";

function boundSession() {
  return bindRunSession({
    actor: { id: "reviewer_1", role: "reviewer" },
    patientId,
    allowedPatientIds: [patientId],
  });
}

function createReviewer() {
  const runs = createInMemoryRunStore();
  const events = createInMemoryEventStore();
  return { reviewer: createSafetyReviewer({ runs, events }), runs, events };
}

describe("safety reviewer runner", () => {
  it("records the complete review on a safety_reviewer run", async () => {
    const { reviewer, runs, events } = createReviewer();

    const outcome = await reviewer.review({
      session: boundSession(),
      sourceRunId: "run_coordinator_1",
      recommendation: {
        summary: "Fictional follow-up coordination may be needed after the unplanned visit.",
        reasoning: "Retrieved demo guidance supports coordination follow-up. This is not a diagnosis.",
        claims: [
          {
            text: "The fictional encounter mentioned an unplanned visit.",
            citationIds: [citationId],
          },
        ],
        proposedActions: [
          {
            type: "create_care_task",
            summary: "Draft a follow-up care task for human review.",
            rationale: "Keep the action reversible after an unplanned visit.",
            citationIds: [citationId],
            executedInRun: false,
          },
        ],
        requiresHumanReview: true,
        uncertainty: { isUncertain: false, reasons: [] },
      },
      retrievedSnippets: [{ citationId, text: "Follow up after an unplanned visit." }],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error(outcome.message);
    }
    expect(outcome.result.decision).toBe("approved");
    expect(outcome.result.requiredApprovals).toContain("create_care_task");
    expect(runs.runs[0]).toMatchObject({
      agentName: "safety_reviewer",
      status: "completed",
      patientId,
    });

    const event = events.events.find((item) => item.eventType === "safety_review");
    expect(event).toBeDefined();
    expect(event?.input).toMatchObject({
      kind: "safety_reviewer",
      sourceRunId: "run_coordinator_1",
    });
    expect(event?.output).toMatchObject({
      decision: "approved",
      policyViolations: [],
      unsupportedClaims: [],
    });
    expect(JSON.stringify(event?.input)).toContain("claims_supported");
  });

  it("fails closed on an invalid recommendation schema without executing anything", async () => {
    const { reviewer, runs } = createReviewer();

    const outcome = await reviewer.review({
      session: boundSession(),
      recommendation: {
        summary: "",
        claims: [],
        proposedActions: [],
      },
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("INVALID_RESULT");
    }
    expect(runs.runs[0]?.status).toBe("failed");
  });

  it("rejects a crafted session object", async () => {
    const { reviewer } = createReviewer();

    await expect(
      reviewer.review({
        session: {
          actor: { id: "reviewer_1", role: "reviewer" },
          patientId,
        } as SafetyReviewerRunInput["session"],
        recommendation: {
          summary: "Fictional review only.",
          claims: [],
          proposedActions: [],
        },
      }),
    ).rejects.toThrow(/bound session/);
  });

  it("does not import the care coordinator, a tool gateway, or a database client", () => {
    const files = [
      "src/agents/safety-reviewer/index.ts",
      "src/agents/safety-reviewer/runner.ts",
      "src/agents/safety-reviewer/schemas.ts",
      "src/safety/reviewer.ts",
      "src/safety/proposal.ts",
    ];

    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/@\/agents\/care-coordinator/);
      expect(source, file).not.toMatch(/@\/tools\/gateway/);
      expect(source, file).not.toMatch(/@\/lib\/db/);
      expect(source, file).not.toMatch(/createCareTask|draftPatientMessage/);
    }
  });
});
