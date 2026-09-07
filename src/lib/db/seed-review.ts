import {
  pendingActionContentHash,
  toPendingActionDrafts,
} from "@/approval/pending-actions";

import { getDb, type Database } from "./client";
import { createRepositories } from "./repositories";

/**
 * A completed care-coordinator run with proposals, a safety review, and hashed
 * pending actions, so the clinician dashboard has something to review. The
 * proposal text is fictional and carries no clinical meaning.
 */
export const reviewFixture = {
  summary:
    "FICTIONAL DEMO: patient reports improving dizziness on current therapy and has no diabetes labs on file since the unplanned visit.",
  reasoning:
    "The encounter notes an unplanned visit and a follow-up interval that has not been scheduled. Care coordination is the gap, not a therapy decision.",
  urgency: "medium",
  confidence: 0.62,
  citationId: "cite:kb_diabetes_followup:1",
  concern: {
    title: "Diabetes follow-up interval not scheduled",
    description:
      "No care-coordination follow-up exists after the unplanned visit, so the documented follow-up interval may lapse.",
  },
  proposedActions: [
    {
      type: "create_care_task",
      summary: "Schedule a 14-day diabetes follow-up call with the care coordinator.",
      rationale:
        "The knowledge base describes a follow-up interval after an unplanned visit, and no task exists yet.",
    },
    {
      type: "draft_patient_message",
      summary: "Draft an outreach message inviting the patient to book the follow-up visit.",
      rationale:
        "Outreach is a draft only. A clinician must approve before anything reaches the patient.",
    },
  ],
} as const;

export type SeededReviewRun = {
  runId: string;
  patientId: string;
  pendingActions: {
    id: string;
    toolName: string;
    contentHash: string;
    policyActionType: string;
  }[];
};

export async function seedReviewFixture(
  db: Database = getDb(),
  options: { runId: string; patientId: string; resetApprovals?: boolean },
): Promise<SeededReviewRun> {
  const repos = createRepositories(db);
  const { runId, patientId } = options;

  const existingRun = await repos.agentRuns.getById(runId);
  if (!existingRun) {
    await repos.agentRuns.create({
      id: runId,
      patientId,
      agentName: "care_coordinator",
      status: "completed",
      startedAt: new Date("2026-09-02T15:00:00.000Z"),
      completedAt: new Date("2026-09-02T15:00:14.000Z"),
    });
  }

  const citationIds = [reviewFixture.citationId];
  const finishOutput = {
    summary: reviewFixture.summary,
    reasoning: reviewFixture.reasoning,
    urgency: reviewFixture.urgency,
    confidence: reviewFixture.confidence,
    requiresHumanReview: true,
    identifiedConcerns: [
      {
        title: reviewFixture.concern.title,
        description: reviewFixture.concern.description,
        urgency: reviewFixture.urgency,
        citationIds,
      },
    ],
    evidence: [
      {
        kind: "retrieved",
        text: "Knowledge-base guidance on follow-up intervals after an unplanned visit.",
        citationId: reviewFixture.citationId,
        toolName: "searchClinicalKnowledge",
      },
      {
        kind: "inferred",
        text: "No follow-up task exists for this patient in the current care plan.",
        citationId: null,
        toolName: null,
      },
    ],
    proposedActions: reviewFixture.proposedActions.map((action) => ({
      ...action,
      citationIds,
      executedInRun: false,
    })),
    uncertainty: {
      isUncertain: true,
      reasons: ["Lab results are not present in the fictional chart."],
    },
  };

  const events = await repos.agentEvents.listByAgentRunId(runId);
  if (!events.some((event) => event.eventType === "think")) {
    await repos.agentEvents.create({
      agentRunId: runId,
      eventType: "think",
      input: { kind: "model_invocation", iteration: 1, schemaName: "CareCoordinatorStep" },
      output: { type: "think", thought: "Gather fictional chart context before proposing anything." },
      timestamp: new Date("2026-09-02T15:00:01.000Z"),
    });
  }
  if (!events.some((event) => event.eventType === "tool_call" && event.toolName === "getPatientContext")) {
    await repos.agentEvents.create({
      agentRunId: runId,
      eventType: "tool_call",
      toolName: "getPatientContext",
      input: { patientId },
      timestamp: new Date("2026-09-02T15:00:02.000Z"),
    });
    await repos.agentEvents.create({
      agentRunId: runId,
      eventType: "tool_result",
      toolName: "getPatientContext",
      input: { patientId },
      output: {
        type: "tool_observation",
        toolName: "getPatientContext",
        ok: true,
        output: { type: "untrusted_data", source: "getPatientContext", data: { patientId } },
      },
      timestamp: new Date("2026-09-02T15:00:03.000Z"),
    });
  }
  if (
    !events.some((event) => event.eventType === "tool_call" && event.toolName === "getRecentEncounters")
  ) {
    await repos.agentEvents.create({
      agentRunId: runId,
      eventType: "tool_call",
      toolName: "getRecentEncounters",
      input: { patientId },
      timestamp: new Date("2026-09-02T15:00:03.200Z"),
    });
    await repos.agentEvents.create({
      agentRunId: runId,
      eventType: "tool_result",
      toolName: "getRecentEncounters",
      input: { patientId },
      output: {
        type: "tool_observation",
        toolName: "getRecentEncounters",
        ok: true,
        output: { type: "untrusted_data", source: "getRecentEncounters", data: { patientId } },
      },
      timestamp: new Date("2026-09-02T15:00:03.400Z"),
    });
  }
  if (!events.some((event) => event.eventType === "tool_call" && event.toolName === "getCarePlan")) {
    await repos.agentEvents.create({
      agentRunId: runId,
      eventType: "tool_call",
      toolName: "getCarePlan",
      input: { patientId },
      timestamp: new Date("2026-09-02T15:00:03.600Z"),
    });
    await repos.agentEvents.create({
      agentRunId: runId,
      eventType: "tool_result",
      toolName: "getCarePlan",
      input: { patientId },
      output: {
        type: "tool_observation",
        toolName: "getCarePlan",
        ok: true,
        output: { type: "untrusted_data", source: "getCarePlan", data: { patientId } },
      },
      timestamp: new Date("2026-09-02T15:00:03.800Z"),
    });
  }
  if (
    !events.some((event) => event.eventType === "tool_call" && event.toolName === "searchClinicalKnowledge")
  ) {
    await repos.agentEvents.create({
      agentRunId: runId,
      eventType: "tool_call",
      toolName: "searchClinicalKnowledge",
      input: { query: "diabetes follow-up after an unplanned clinic visit" },
      timestamp: new Date("2026-09-02T15:00:04.000Z"),
    });
    await repos.agentEvents.create({
      agentRunId: runId,
      eventType: "tool_result",
      toolName: "searchClinicalKnowledge",
      input: { query: "diabetes follow-up after an unplanned clinic visit" },
      output: {
        type: "tool_observation",
        toolName: "searchClinicalKnowledge",
        ok: true,
        output: {
          type: "untrusted_data",
          source: "searchClinicalKnowledge",
          data: { query: "diabetes follow-up", results: [{ citationId: reviewFixture.citationId }] },
        },
      },
      timestamp: new Date("2026-09-02T15:00:05.000Z"),
    });
  }
  if (!events.some((event) => event.eventType === "finish")) {
    await repos.agentEvents.create({
      agentRunId: runId,
      eventType: "finish",
      output: finishOutput,
      timestamp: new Date("2026-09-02T15:00:12.000Z"),
    });
  }
  if (!events.some((event) => event.eventType === "safety_review")) {
    await repos.agentEvents.create({
      agentRunId: runId,
      eventType: "safety_review",
      input: { proposalSummary: reviewFixture.summary },
      output: {
        decision: "approved",
        reasons: ["No prohibited capability requested."],
        policyViolations: [],
        unsupportedClaims: [],
        requiredApprovals: ["draft_patient_message requires human approval before send"],
        evidenceIssues: [],
      },
      timestamp: new Date("2026-09-02T15:00:13.000Z"),
    });
  }

  const drafts = toPendingActionDrafts(
    {
      urgency: reviewFixture.urgency,
      proposedActions: finishOutput.proposedActions.map((action) => ({
        type: action.type,
        summary: action.summary,
        rationale: action.rationale,
        citationIds: [...action.citationIds],
      })),
    },
    { patientId },
  );

  const existing = await repos.approvalRequests.listByAgentRunId(runId);
  const pendingActions: SeededReviewRun["pendingActions"] = [];

  for (const [index, draft] of drafts.entries()) {
    const id = `${runId}_action_${index}`;
    const already = existing.find((request) => request.id === id);
    if (!already) {
      await repos.approvalRequests.create({
        id,
        agentRunId: runId,
        status: "pending",
        requestedAt: new Date(`2026-09-02T15:00:1${3 + index}.000Z`),
        action: {
          type: draft.toolName,
          payload: {
            policyActionType: draft.policyActionType,
            args: draft.args,
            proposal: draft.proposal,
          },
        },
      });
    } else if (options.resetApprovals && already.status !== "pending") {
      // Rehearsals approve this run. `npm run db:seed` restores the interview
      // Approve click without wiping the append-only audit log.
      await repos.approvalRequests.update(id, {
        status: "pending",
        reviewedAt: null,
        reviewer: null,
        reason: null,
      });
    }

    pendingActions.push({
      id,
      toolName: draft.toolName,
      policyActionType: draft.policyActionType,
      contentHash: pendingActionContentHash({
        agentRunId: runId,
        toolName: draft.toolName,
        args: draft.args,
      }),
    });
  }

  return { runId, patientId, pendingActions };
}
