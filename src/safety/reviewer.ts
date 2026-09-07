import {
  actionRequiresHumanApproval,
  isAllowedRecommendationAction,
} from "@/policy/recommendation-policy";

import {
  containsApprovalBypass,
  containsClinicalLanguage,
  containsDiagnosisClaim,
  containsMedicationChange,
  containsPrivilegeEscalation,
  detectUnauthorizedDisclosure,
  snippetSupportsClaim,
} from "./claims";
import type { ProposedRecommendation, SafetyReviewerResult } from "./proposal";
import type { RetrievedSnippet } from "./review";

export type SafetyReviewerContext = {
  patientScope: string;
  retrievedSnippets: readonly RetrievedSnippet[];
};

/**
 * Deterministic safety reviewer. The model cannot approve its own work.
 * `approved` means the recommendation passed these checks; it does not
 * authorize execution.
 */
export function reviewProposedRecommendation(
  recommendation: ProposedRecommendation,
  context: SafetyReviewerContext,
): SafetyReviewerResult {
  const reasons: string[] = [];
  const policyViolations: string[] = [];
  const unsupportedClaims: string[] = [];
  const requiredApprovals: string[] = [];
  const evidenceIssues: string[] = [];

  const texts = collectTexts(recommendation);
  const joined = texts.join("\n");
  const snippetsById = new Map(context.retrievedSnippets.map((snippet) => [snippet.citationId, snippet]));

  if (texts.some((text) => containsDiagnosisClaim(text))) {
    policyViolations.push("diagnosis_claim");
    reasons.push("recommendation attempts to diagnose");
  }

  if (texts.some((text) => containsMedicationChange(text))) {
    policyViolations.push("medication_change");
    reasons.push("recommendation attempts to change medication");
  }

  const disclosure = detectUnauthorizedDisclosure(joined, context.patientScope);
  if (disclosure) {
    policyViolations.push("unauthorized_disclosure");
    reasons.push(disclosure);
  }

  if (containsApprovalBypass(joined) || recommendation.requiresHumanReview === false) {
    policyViolations.push("approval_bypass");
    reasons.push("recommendation attempts to skip human approval");
  }

  if (containsPrivilegeEscalation(joined)) {
    policyViolations.push("privilege_escalation");
    reasons.push("recommendation attempts to change role or privileges");
  }

  for (const action of recommendation.proposedActions) {
    if (!isAllowedRecommendationAction(action.type)) {
      policyViolations.push("out_of_scope_action");
      reasons.push(`action type is outside the allowed scope: ${action.type}`);
    }
    if (action.executedInRun === true) {
      policyViolations.push("executed_in_run");
      reasons.push("recommendation claims a write already executed");
    }
    if (actionRequiresHumanApproval(action.type)) {
      requiredApprovals.push(action.type);
    }
  }

  const claims = collectClaims(recommendation);
  const usedCitationIds = claims.flatMap((claim) => claim.citationIds);

  const fabricated = [...new Set(usedCitationIds.filter((id) => !snippetsById.has(id)))];
  if (fabricated.length > 0) {
    evidenceIssues.push("fabricated_citation");
    reasons.push(`citation IDs were not retrieved in this run: ${fabricated.join(", ")}`);
  }

  const hasClinical = claims.length > 0 || texts.some((text) => containsClinicalLanguage(text));
  if (hasClinical && context.retrievedSnippets.length === 0) {
    evidenceIssues.push("insufficient_evidence");
    reasons.push("clinical claims lack retrieved evidence");
  }

  if (hasClinical && usedCitationIds.length === 0) {
    evidenceIssues.push("missing_citation");
    reasons.push("clinical claims are missing citation IDs");
  }

  if (recommendation.uncertainty?.isUncertain && hasClinical) {
    evidenceIssues.push("insufficient_evidence");
    reasons.push("recommendation marks its own evidence as insufficient");
  }

  for (const claim of claims) {
    const ids = claim.citationIds.length > 0 ? claim.citationIds : usedCitationIds;
    const supported = ids.some((id) => {
      const snippet = snippetsById.get(id);
      return snippet ? snippetSupportsClaim(claim.text, snippet.text) : false;
    });
    if (!supported) {
      unsupportedClaims.push(claim.text);
      evidenceIssues.push("irrelevant_citation");
    }
  }

  if (requiredApprovals.length === 0 && (hasClinical || recommendation.proposedActions.length > 0)) {
    requiredApprovals.push("human_review");
  }

  const unique = (values: string[]) => [...new Set(values)];
  const decision = decide({
    policyViolations: unique(policyViolations),
    unsupportedClaims: unique(unsupportedClaims),
    evidenceIssues: unique(evidenceIssues),
  });

  if (decision === "approved") {
    reasons.push("safety checks passed");
    if (unique(requiredApprovals).length > 0) {
      reasons.push("human approval is still required before any action executes");
    }
  }

  return {
    decision,
    reasons: unique(reasons),
    policyViolations: unique(policyViolations),
    unsupportedClaims: unique(unsupportedClaims),
    requiredApprovals: unique(requiredApprovals),
    evidenceIssues: unique(evidenceIssues),
  };
}

function decide(input: {
  policyViolations: string[];
  unsupportedClaims: string[];
  evidenceIssues: string[];
}): SafetyReviewerResult["decision"] {
  if (input.policyViolations.length > 0) {
    return "rejected";
  }
  if (input.unsupportedClaims.length > 0 || input.evidenceIssues.length > 0) {
    return "needs_revision";
  }
  return "approved";
}

function collectTexts(recommendation: ProposedRecommendation): string[] {
  return [
    recommendation.summary,
    recommendation.reasoning ?? "",
    ...recommendation.claims.map((claim) => claim.text),
    ...recommendation.proposedActions.map((action) => `${action.summary} ${action.rationale}`),
  ].filter((text) => text.length > 0);
}

function collectClaims(recommendation: ProposedRecommendation): { text: string; citationIds: string[] }[] {
  const claims = recommendation.claims.map((claim) => ({
    text: claim.text,
    citationIds: claim.citationIds,
  }));

  for (const action of recommendation.proposedActions) {
    const text = `${action.summary} ${action.rationale}`;
    if (action.type !== "observe_only" && containsClinicalLanguage(text)) {
      claims.push({ text, citationIds: action.citationIds });
    }
  }

  for (const text of [recommendation.summary, recommendation.reasoning ?? ""]) {
    if (containsClinicalLanguage(text)) {
      claims.push({
        text,
        citationIds: recommendation.claims.flatMap((claim) => claim.citationIds),
      });
    }
  }

  return claims;
}
