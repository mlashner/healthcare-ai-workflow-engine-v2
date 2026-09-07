import { z } from "zod";

import { parsePendingAction, type ParsedPendingAction } from "@/approval/pending-actions";
import { pendingActionToolNames } from "@/approval/pending-actions";
import type { Repositories } from "@/lib/db/repositories";
import type { AgentRun, ApprovalStatus } from "@/lib/domain";
import { evaluateAction, type PolicyActor, type PolicyDecision } from "@/policy/action-policy";

/**
 * Provenance is the core affordance of the review UI: a clinician must always
 * be able to tell retrieved fact from model inference, and a proposal from
 * something that actually happened.
 */
export const provenanceKinds = [
  "retrieved",
  "reasoning",
  "proposal",
  "policy",
  "human",
  "executed",
] as const;

export type Provenance = (typeof provenanceKinds)[number];

const finishResultSchema = z
  .object({
    summary: z.string().default(""),
    reasoning: z.string().default(""),
    urgency: z.string().default("none"),
    confidence: z.number().nullish(),
    requiresHumanReview: z.boolean().nullish(),
    identifiedConcerns: z
      .array(
        z.object({
          title: z.string().default("Concern"),
          description: z.string().default(""),
          urgency: z.string().default("none"),
          citationIds: z.array(z.string()).default([]),
        }),
      )
      .default([]),
    evidence: z
      .array(
        z.object({
          kind: z.string().default("inferred"),
          text: z.string().default(""),
          citationId: z.string().nullish(),
          toolName: z.string().nullish(),
        }),
      )
      .default([]),
    proposedActions: z
      .array(
        z.object({
          type: z.string().default("observe_only"),
          summary: z.string().default(""),
          rationale: z.string().default(""),
          citationIds: z.array(z.string()).default([]),
          executedInRun: z.boolean().default(false),
        }),
      )
      .default([]),
    uncertainty: z
      .object({
        isUncertain: z.boolean().default(false),
        reasons: z.array(z.string()).default([]),
      })
      .default({ isUncertain: false, reasons: [] }),
  })
  .loose();

const safetyEventSchema = z
  .object({
    passed: z.boolean().nullish(),
    issues: z.array(z.string()).nullish(),
    decision: z.string().nullish(),
    reasons: z.array(z.string()).nullish(),
    policyViolations: z.array(z.string()).nullish(),
    unsupportedClaims: z.array(z.string()).nullish(),
    requiredApprovals: z.array(z.string()).nullish(),
    evidenceIssues: z.array(z.string()).nullish(),
  })
  .loose();

const humanDecisionSchema = z
  .object({
    kind: z.literal("human_decision"),
    decision: z.string(),
    pendingActionId: z.string(),
    actorId: z.string(),
    contentHash: z.string(),
    note: z.string().nullish(),
  })
  .loose();

export type ReviewEvidence = {
  kind: "retrieved" | "inferred";
  text: string;
  citationId: string | null;
  citationTitle: string | null;
  citationText: string | null;
  citationVerified: boolean;
};

export type ReviewPendingAction = ParsedPendingAction & {
  policyDecision: PolicyDecision;
};

export type ReviewHumanDecision = {
  decision: string;
  pendingActionId: string;
  actorId: string;
  contentHash: string;
  note: string | null;
  at: Date;
};

export type ReviewExecutedAction = {
  toolName: string;
  code: string;
  message: string;
  actorId: string;
  at: Date;
};

export type ReviewSafety = {
  decision: string;
  issues: string[];
  policyViolations: string[];
  unsupportedClaims: string[];
  requiredApprovals: string[];
  evidenceIssues: string[];
};

export type ClinicianReview = {
  run: AgentRun;
  patient: {
    id: string;
    name: string;
    dateOfBirth: string;
    conditions: { name: string; notes?: string }[];
    medications: { name: string; dosage?: string; frequency?: string }[];
  } | null;
  encounter: { id: string; providerId: string; occurredAt: Date; transcript: string } | null;
  summary: string;
  reasoning: string;
  urgency: string;
  confidence: number | null;
  uncertainty: { isUncertain: boolean; reasons: string[] };
  concerns: {
    title: string;
    description: string;
    urgency: string;
    citationIds: string[];
  }[];
  evidence: ReviewEvidence[];
  proposedActions: {
    type: string;
    summary: string;
    rationale: string;
    citationIds: string[];
    executedInRun: boolean;
  }[];
  safety: ReviewSafety | null;
  pendingActions: ReviewPendingAction[];
  humanDecisions: ReviewHumanDecision[];
  executedActions: ReviewExecutedAction[];
  approvalSummary: Record<ApprovalStatus, number>;
};

type ReviewRepos = Pick<
  Repositories,
  | "agentRuns"
  | "agentEvents"
  | "approvalRequests"
  | "auditEvents"
  | "patients"
  | "encounters"
  | "documentChunks"
>;

/**
 * Read-only assembly for the clinician dashboard. Everything shown is derived
 * from durable control-plane records, so the page cannot display an action as
 * executed unless the audit log says it executed.
 */
export async function loadClinicianReview(
  repos: ReviewRepos,
  runId: string,
  viewer: { actor: PolicyActor; authorizedPatientIds: string[] },
): Promise<ClinicianReview | null> {
  const run = await repos.agentRuns.getById(runId);
  if (!run) {
    return null;
  }
  if (!viewer.authorizedPatientIds.includes(run.patientId)) {
    return null;
  }

  const [patient, encounters, events, approvals, audits] = await Promise.all([
    repos.patients.getById(run.patientId),
    repos.encounters.listByPatientId(run.patientId),
    repos.agentEvents.listByAgentRunId(run.id),
    repos.approvalRequests.listByAgentRunId(run.id),
    repos.auditEvents.listByAgentRunId(run.id),
  ]);

  const finishEvent = [...events].reverse().find((event) => event.eventType === "finish");
  const parsedFinish = finishEvent
    ? finishResultSchema.safeParse(finishEvent.output)
    : undefined;
  const finish = parsedFinish?.success ? parsedFinish.data : undefined;

  const safetyEvent = [...events].reverse().find((event) => event.eventType === "safety_review");
  const safety = toReviewSafety(safetyEvent?.output);

  const evidence = await Promise.all(
    (finish?.evidence ?? []).map(async (item) => {
      const citationId = item.citationId ?? null;
      const chunk = citationId ? await repos.documentChunks.getByCitationId(citationId) : null;

      return {
        kind: item.kind === "retrieved" ? ("retrieved" as const) : ("inferred" as const),
        text: item.text,
        citationId,
        citationTitle: chunk?.title ?? null,
        citationText: chunk?.chunk.content ?? null,
        citationVerified: Boolean(chunk),
      } satisfies ReviewEvidence;
    }),
  );

  const patientContext = {
    patientId: run.patientId,
    authorizedPatientIds: viewer.authorizedPatientIds,
  };

  const pendingActions: ReviewPendingAction[] = [];
  for (const approval of approvals) {
    const parsed = parsePendingAction(approval);
    if (!parsed) {
      continue;
    }
    pendingActions.push({
      ...parsed,
      // Preview only. The decisive evaluation happens in the approval route
      // and is written to the audit log there.
      policyDecision: evaluateAction(
        { type: parsed.policyActionType, patientId: run.patientId },
        viewer.actor,
        patientContext,
      ),
    });
  }
  pendingActions.sort((left, right) => left.requestedAt.getTime() - right.requestedAt.getTime());

  const humanDecisions: ReviewHumanDecision[] = [];
  for (const event of events) {
    if (event.eventType !== "policy_decision") {
      continue;
    }
    const parsed = humanDecisionSchema.safeParse(event.output);
    if (!parsed.success) {
      continue;
    }
    humanDecisions.push({
      decision: parsed.data.decision,
      pendingActionId: parsed.data.pendingActionId,
      actorId: parsed.data.actorId,
      contentHash: parsed.data.contentHash,
      note: parsed.data.note ?? null,
      at: event.timestamp,
    });
  }

  const writeTools = new Set<string>(pendingActionToolNames);
  const executedActions: ReviewExecutedAction[] = audits
    .filter((event) => event.outcome === "executed" && writeTools.has(event.toolName))
    .map((event) => ({
      toolName: event.toolName,
      code: event.code,
      message: event.message,
      actorId: event.actorId,
      at: event.createdAt,
    }))
    .sort((left, right) => left.at.getTime() - right.at.getTime());

  const approvalSummary: Record<ApprovalStatus, number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
  };
  for (const action of pendingActions) {
    approvalSummary[action.status] += 1;
  }

  return {
    run,
    patient: patient
      ? {
          id: patient.id,
          name: patient.name,
          dateOfBirth: patient.dateOfBirth,
          conditions: patient.conditions,
          medications: patient.medications,
        }
      : null,
    encounter: encounters[0]
      ? {
          id: encounters[0].id,
          providerId: encounters[0].providerId,
          occurredAt: encounters[0].occurredAt,
          transcript: encounters[0].transcript,
        }
      : null,
    summary: finish?.summary ?? "",
    reasoning: finish?.reasoning ?? "",
    urgency: finish?.urgency ?? "none",
    confidence: finish?.confidence ?? null,
    uncertainty: finish?.uncertainty ?? { isUncertain: false, reasons: [] },
    concerns: finish?.identifiedConcerns ?? [],
    evidence,
    proposedActions: finish?.proposedActions ?? [],
    safety,
    pendingActions,
    humanDecisions,
    executedActions,
    approvalSummary,
  };
}

function toReviewSafety(output: unknown): ReviewSafety | null {
  if (output === null || output === undefined) {
    return null;
  }
  const parsed = safetyEventSchema.safeParse(output);
  if (!parsed.success) {
    return null;
  }

  const data = parsed.data;
  const decision =
    data.decision ?? (data.passed === true ? "passed" : data.passed === false ? "failed" : "unknown");

  return {
    decision,
    issues: data.issues ?? data.reasons ?? [],
    policyViolations: data.policyViolations ?? [],
    unsupportedClaims: data.unsupportedClaims ?? [],
    requiredApprovals: data.requiredApprovals ?? [],
    evidenceIssues: data.evidenceIssues ?? [],
  };
}
