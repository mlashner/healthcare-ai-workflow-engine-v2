import type { CareCoordinatorResult } from "@/agents/care-coordinator/schemas";

import {
  containsClinicalLanguage,
  containsDiagnosisClaim,
  snippetSupportsClaim,
} from "./claims";

export type RetrievedSnippet = {
  citationId: string;
  text: string;
};

export type SafetyReviewContext = {
  retrievedSnippets: RetrievedSnippet[];
};

export type SafetyReview = {
  passed: boolean;
  issues: string[];
  requiresHumanReview: true;
};

export function reviewCareCoordinatorSafety(
  result: CareCoordinatorResult,
  context: SafetyReviewContext,
): SafetyReview {
  const issues: string[] = [];
  const snippetsById = new Map(context.retrievedSnippets.map((snippet) => [snippet.citationId, snippet]));
  const texts = collectResultTexts(result);

  for (const text of texts) {
    if (containsDiagnosisClaim(text)) {
      issues.push("result claims to diagnose a patient");
      break;
    }
  }

  const usedCitationIds = [
    ...result.identifiedConcerns.flatMap((concern) => concern.citationIds),
    ...result.proposedActions.flatMap((action) => action.citationIds),
    ...result.evidence.flatMap((item) => (item.citationId ? [item.citationId] : [])),
  ];

  const fabricated = usedCitationIds.filter((id) => !snippetsById.has(id));
  if (fabricated.length > 0) {
    issues.push(`citation IDs were not retrieved in this run: ${fabricated.join(", ")}`);
  }

  for (const item of result.evidence) {
    if (item.kind === "retrieved" && !item.citationId) {
      issues.push("retrieved evidence is missing a citationId");
    }
  }

  const claimTexts = [
    ...result.identifiedConcerns.map((concern) => `${concern.title} ${concern.description}`),
    ...result.proposedActions
      .filter(
        (action) =>
          action.type !== "observe_only" &&
          containsClinicalLanguage(`${action.summary} ${action.rationale}`),
      )
      .map((action) => `${action.summary} ${action.rationale}`),
    ...result.evidence.filter((item) => item.kind === "retrieved").map((item) => item.text),
    ...[result.summary, result.reasoning].filter((text) => containsClinicalLanguage(text)),
  ];

  if (claimTexts.length > 0 && usedCitationIds.length === 0) {
    issues.push("clinical claims require retrieved citation IDs from this run");
  }

  for (const claim of claimTexts) {
    const cited = citationsForClaim(result, claim);
    const ids = cited.length > 0 ? cited : usedCitationIds;
    const supported = ids.some((id) => {
      const snippet = snippetsById.get(id);
      return snippet ? snippetSupportsClaim(claim, snippet.text) : false;
    });
    if (!supported) {
      issues.push("a clinical claim is not supported by a retrieved snippet");
      break;
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    requiresHumanReview: true,
  };
}

function collectResultTexts(result: CareCoordinatorResult): string[] {
  return [
    result.summary,
    result.reasoning,
    ...result.identifiedConcerns.map((concern) => `${concern.title}. ${concern.description}`),
    ...result.proposedActions.map((action) => `${action.summary}. ${action.rationale}`),
    ...result.evidence.map((item) => item.text),
  ];
}

function citationsForClaim(result: CareCoordinatorResult, claim: string): string[] {
  for (const concern of result.identifiedConcerns) {
    if (`${concern.title} ${concern.description}` === claim) {
      return concern.citationIds;
    }
  }
  for (const action of result.proposedActions) {
    if (`${action.summary} ${action.rationale}` === claim) {
      return action.citationIds;
    }
  }
  for (const item of result.evidence) {
    if (item.text === claim && item.citationId) {
      return [item.citationId];
    }
  }
  return [];
}
