import type { CareCoordinatorResult } from "./schemas";

export type ResultCheckContext = {
  retrievedCitationIds: Set<string>;
};

export type ResultCheck =
  | { ok: true; result: CareCoordinatorResult; notes: string[] }
  | { ok: false; issues: string[] };

/**
 * Control-plane overlays only. Citation support and diagnosis language are
 * enforced in `src/safety/`, not here.
 */
export function validateCareCoordinatorResult(
  result: CareCoordinatorResult,
  context: ResultCheckContext,
): ResultCheck {
  const notes: string[] = [];
  const next: CareCoordinatorResult = {
    ...result,
    identifiedConcerns: result.identifiedConcerns.map((concern) => ({ ...concern })),
    evidence: result.evidence.map((item) => ({ ...item })),
    proposedActions: result.proposedActions.map((action) => ({
      ...action,
      executedInRun: false,
    })),
    requiresHumanReview: true,
    uncertainty: {
      isUncertain: result.uncertainty.isUncertain,
      reasons: [...result.uncertainty.reasons],
    },
  };

  if (!next.uncertainty.isUncertain && context.retrievedCitationIds.size === 0) {
    next.uncertainty.isUncertain = true;
    next.uncertainty.reasons.push(
      "Evidence retrieved in this run is insufficient for a confident recommendation.",
    );
    notes.push("control plane marked the result uncertain because evidence was insufficient");
  }

  if (next.uncertainty.isUncertain && next.confidence > 0.4) {
    next.confidence = 0.4;
    notes.push("control plane capped confidence because the result is uncertain");
  }

  if (!result.requiresHumanReview) {
    notes.push("control plane required human review");
  }

  return { ok: true, result: next, notes };
}
