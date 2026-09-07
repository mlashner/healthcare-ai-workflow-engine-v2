import { z } from "zod";

import { citationIdSchema, entityIdSchema, type ApprovalRequest } from "@/lib/domain";
import { policyActionTypes, type PolicyActionType } from "@/policy/action-policy";
import { hashJson } from "@/tools/hash";

/**
 * A proposal becomes executable only as a `PendingAction`: a tool name plus
 * exact arguments, hashed so approval binds the bytes that will execute.
 */
export const pendingActionToolNames = [
  "createCareTask",
  "draftPatientMessage",
  "requestHumanApproval",
] as const;

export type PendingActionToolName = (typeof pendingActionToolNames)[number];

export const pendingActionProposalSchema = z
  .object({
    summary: z.string().min(1).max(1000),
    rationale: z.string().min(1).max(2000),
    citationIds: z.array(citationIdSchema).max(20),
  })
  .strict();

export const pendingActionPayloadSchema = z
  .object({
    policyActionType: z.enum(policyActionTypes),
    args: z.record(z.string(), z.unknown()),
    proposal: pendingActionProposalSchema,
  })
  .strict();

export const pendingActionSchema = z
  .object({
    type: z.enum(pendingActionToolNames),
    payload: pendingActionPayloadSchema,
  })
  .strict();

export type PendingActionProposal = z.output<typeof pendingActionProposalSchema>;
export type PendingActionPayload = z.output<typeof pendingActionPayloadSchema>;
export type PendingActionRecord = z.output<typeof pendingActionSchema>;

export type PendingActionDraft = {
  toolName: PendingActionToolName;
  policyActionType: PolicyActionType;
  args: Record<string, unknown>;
  proposal: PendingActionProposal;
};

type ProposedAction = {
  type: string;
  summary: string;
  rationale: string;
  citationIds: string[];
};

const urgencyToPriority: Record<string, "low" | "medium" | "high" | "urgent"> = {
  none: "low",
  low: "low",
  medium: "medium",
  high: "high",
  urgent: "urgent",
};

/**
 * Deterministic mapping from the agent's proposal vocabulary to typed tool
 * arguments. The model never supplies tool arguments directly.
 */
export function toPendingActionDrafts(
  result: { proposedActions: ProposedAction[]; urgency: string },
  context: { patientId: string },
): PendingActionDraft[] {
  const drafts: PendingActionDraft[] = [];
  const priority = urgencyToPriority[result.urgency] ?? "medium";

  for (const action of result.proposedActions) {
    const proposal: PendingActionProposal = {
      summary: action.summary,
      rationale: action.rationale,
      citationIds: action.citationIds,
    };

    if (action.type === "create_care_task") {
      drafts.push({
        toolName: "createCareTask",
        policyActionType: "create_care_task",
        args: {
          patientId: context.patientId,
          type: "follow_up",
          description: action.summary,
          priority,
        },
        proposal,
      });
      continue;
    }

    if (action.type === "draft_patient_message") {
      drafts.push({
        toolName: "draftPatientMessage",
        policyActionType: "draft_patient_message",
        args: {
          patientId: context.patientId,
          purpose: action.summary,
          talkingPoints: [action.rationale],
        },
        proposal,
      });
      continue;
    }

    if (action.type === "request_human_approval") {
      drafts.push({
        toolName: "requestHumanApproval",
        policyActionType: "send_patient_message",
        args: {
          actionType: "notify_care_team",
          payload: { patientId: context.patientId },
          reason: action.summary,
        },
        proposal,
      });
    }

    // `observe_only` proposes no side effect, so it never becomes a PendingAction.
  }

  return drafts;
}

export function pendingActionContentHash(input: {
  agentRunId: string;
  toolName: string;
  args: unknown;
}): string {
  return hashJson({
    agentRunId: input.agentRunId,
    toolName: input.toolName,
    args: input.args,
  });
}

export type ParsedPendingAction = {
  id: string;
  agentRunId: string;
  toolName: PendingActionToolName;
  policyActionType: PolicyActionType;
  args: Record<string, unknown>;
  proposal: PendingActionProposal;
  contentHash: string;
  status: ApprovalRequest["status"];
  reviewer: string | null;
  reason: string | null;
  requestedAt: Date;
  reviewedAt: Date | null;
};

/**
 * Reads a stored approval row back into a pending action. Rows that do not
 * match the schema are rejected rather than coerced, so a malformed or
 * tampered row cannot execute.
 */
export function parsePendingAction(request: ApprovalRequest): ParsedPendingAction | null {
  const parsed = pendingActionSchema.safeParse(request.action);
  if (!parsed.success) {
    return null;
  }
  if (!entityIdSchema.safeParse(request.agentRunId).success) {
    return null;
  }

  return {
    id: request.id,
    agentRunId: request.agentRunId,
    toolName: parsed.data.type,
    policyActionType: parsed.data.payload.policyActionType,
    args: parsed.data.payload.args,
    proposal: parsed.data.payload.proposal,
    contentHash: pendingActionContentHash({
      agentRunId: request.agentRunId,
      toolName: parsed.data.type,
      args: parsed.data.payload.args,
    }),
    status: request.status,
    reviewer: request.reviewer,
    reason: request.reason,
    requestedAt: request.requestedAt,
    reviewedAt: request.reviewedAt,
  };
}
