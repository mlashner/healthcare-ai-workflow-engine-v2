import { redact } from "@/lib/logger";
import { isBoundRunSession } from "@/runs/session";
import type { EventStore, RunStore } from "@/runs/stores";
import type { AgentRunOutcome } from "@/runs/types";
import {
  proposedRecommendationSchema,
  type SafetyReviewerResult,
} from "@/safety/proposal";
import { reviewProposedRecommendation } from "@/safety/reviewer";

import type { SafetyReviewerRunInput } from "./schemas";

const REVIEW_CHECKS = [
  "claims_supported",
  "citations_relevant",
  "within_allowed_scope",
  "no_diagnosis",
  "no_medication_change",
  "no_unauthorized_disclosure",
  "human_approval",
  "evidence_sufficiency",
  "policy_compliance",
] as const;

/**
 * Separate safety-review stage. It never receives a tool gateway and cannot
 * persist side effects. The structured decision is advisory for privileges:
 * `approved` does not execute anything.
 */
export function createSafetyReviewer(deps: { runs: RunStore; events: EventStore }) {
  return {
    async review(input: SafetyReviewerRunInput): Promise<AgentRunOutcome<SafetyReviewerResult>> {
      if (!isBoundRunSession(input.session)) {
        throw new Error("safety reviewer runs require a bound session from bindRunSession");
      }

      const parsed = proposedRecommendationSchema.safeParse(input.recommendation);
      const run = await deps.runs.create({
        id: input.agentRunId,
        patientId: input.session.patientId,
        agentName: "safety_reviewer",
        status: "running",
      });

      if (!parsed.success) {
        const message = parsed.error.issues.map((issue) => issue.message).join("; ");
        await recordReviewEvent(deps.events, run.id, input, {
          kind: "invalid_recommendation",
          issues: parsed.error.issues.map((issue) => issue.message),
        });
        await deps.runs.update(run.id, { status: "failed", completedAt: new Date() });
        return {
          ok: false,
          status: "failed",
          runId: run.id,
          code: "INVALID_RESULT",
          message,
          events: await deps.events.listByAgentRunId(run.id),
        };
      }

      const result = reviewProposedRecommendation(parsed.data, {
        patientScope: input.session.patientId,
        retrievedSnippets: input.retrievedSnippets ?? [],
      });

      await recordReviewEvent(deps.events, run.id, input, result);
      await deps.runs.update(run.id, { status: "completed", completedAt: new Date() });

      return {
        ok: true,
        status: "completed",
        runId: run.id,
        result,
        events: await deps.events.listByAgentRunId(run.id),
      };
    },
  };
}

export type SafetyReviewer = ReturnType<typeof createSafetyReviewer>;

async function recordReviewEvent(
  events: EventStore,
  runId: string,
  input: SafetyReviewerRunInput,
  output: unknown,
): Promise<void> {
  await events.create({
    agentRunId: runId,
    eventType: "safety_review",
    input: redact({
      kind: "safety_reviewer",
      checks: REVIEW_CHECKS,
      sourceRunId: input.sourceRunId,
      recommendation: input.recommendation,
      retrievedCitationIds: (input.retrievedSnippets ?? []).map((snippet) => snippet.citationId),
    }),
    output: redact(output),
  });
}
