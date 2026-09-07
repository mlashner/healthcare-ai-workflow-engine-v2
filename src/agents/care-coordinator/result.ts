import { citationIdSchema } from "@/lib/domain";

import type { CareCoordinatorResult } from "./schemas";

export type ResultCheckContext = {
  retrievedCitationIds: Set<string>;
  successfulTools: string[];
};

export type ResultCheck =
  | { ok: true; result: CareCoordinatorResult; notes: string[] }
  | { ok: false; issues: string[] };

const DIAGNOSIS_CLAIM =
  /\b((i|we)\s+(diagnose|diagnosed|are diagnosing)|(?:this|that)\s+is\s+(?:a|the)\s+diagnosis|new diagnosis of|(?:patient|they)\s+(?:is|are|was|were)\s+diagnosed|confirms?\s+(?:a|the)\s+diagnosis)\b/i;

export function collectCitationIds(value: unknown): string[] {
  const found = new Set<string>();
  walk(value, found);
  return [...found];
}

function walk(value: unknown, found: Set<string>): void {
  if (typeof value === "string") {
    if (citationIdSchema.safeParse(value).success) {
      found.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, found);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) {
      walk(nested, found);
    }
  }
}

export function containsDiagnosisClaim(text: string): boolean {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.some((sentence) => {
    const negated =
      /\b(not|never|do not|don't|cannot|can't|no)\b/i.test(sentence) &&
      /\bdiagnos/i.test(sentence);
    if (negated) {
      return false;
    }
    return DIAGNOSIS_CLAIM.test(sentence);
  });
}

export function validateCareCoordinatorResult(
  result: CareCoordinatorResult,
  context: ResultCheckContext,
): ResultCheck {
  const issues: string[] = [];
  const notes: string[] = [];
  const texts = [
    result.summary,
    result.reasoning,
    ...result.identifiedConcerns.map((concern) => `${concern.title}. ${concern.description}`),
    ...result.proposedActions.map((action) => `${action.summary}. ${action.rationale}`),
    ...result.evidence.map((item) => item.text),
  ];

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

  const fabricated = usedCitationIds.filter((id) => !context.retrievedCitationIds.has(id));
  if (fabricated.length > 0) {
    issues.push(`citation IDs were not retrieved in this run: ${fabricated.join(", ")}`);
  }

  for (const item of result.evidence) {
    if (item.kind === "retrieved" && !item.citationId) {
      issues.push("retrieved evidence is missing a citationId");
    }
  }

  const hasClinicalClaims = result.identifiedConcerns.length > 0;
  const hasRetrievedSupport = usedCitationIds.some((id) => context.retrievedCitationIds.has(id));
  if (hasClinicalClaims && !hasRetrievedSupport) {
    issues.push("clinical claims require retrieved citation IDs from this run");
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const next: CareCoordinatorResult = {
    ...result,
    identifiedConcerns: result.identifiedConcerns.map((concern) => ({ ...concern })),
    evidence: result.evidence.map((item) => ({ ...item })),
    proposedActions: result.proposedActions.map((action) => ({
      ...action,
      executedInRun: actionExecutedInRun(action.type, context.successfulTools),
    })),
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

  if (next.uncertainty.isUncertain || next.identifiedConcerns.length > 0 || next.urgency === "high" || next.urgency === "urgent") {
    if (!next.requiresHumanReview) {
      next.requiresHumanReview = true;
      notes.push("control plane required human review");
    }
  }

  if (next.uncertainty.isUncertain && next.confidence > 0.4) {
    next.confidence = 0.4;
    notes.push("control plane capped confidence because the result is uncertain");
  }

  return { ok: true, result: next, notes };
}

function actionExecutedInRun(type: CareCoordinatorResult["proposedActions"][number]["type"], tools: string[]): boolean {
  if (type === "create_care_task") {
    return tools.includes("createCareTask");
  }
  if (type === "draft_patient_message") {
    return tools.includes("draftPatientMessage");
  }
  if (type === "request_human_approval") {
    return tools.includes("requestHumanApproval");
  }
  return false;
}
