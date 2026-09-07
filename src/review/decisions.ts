import { z } from "zod";

import { parsePendingAction, pendingActionContentHash } from "@/approval/pending-actions";
import type { ParsedPendingAction } from "@/approval/pending-actions";
import type { AuditWriter } from "@/audit/writer";
import type { ResolvedClinician } from "@/authz/patient-access";
import type { Repositories } from "@/lib/db/repositories";
import { agentIdentities, type AgentIdentity, type AgentRun } from "@/lib/domain";
import { POLICY_VERSION } from "@/policy/action-policy";
import { grantHumanApproval } from "@/policy/approvals";
import { createAuditedPolicyEngine } from "@/policy/audit";
import type { ToolGateway } from "@/tools/gateway";
import type { ToolRegistry } from "@/tools/registry";

import { imposePatientScope } from "./patient-scope";

/**
 * The client may only say what it decided and which bytes it was looking at.
 * Identity, patient scope, tool name, and tool arguments are read server-side.
 */
export const reviewDecisionRequestSchema = z
  .object({
    decision: z.enum(["approve", "reject", "edit"]),
    expectedContentHash: z.string().min(16).max(128),
    note: z.string().min(1).max(2000).optional(),
    edits: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ReviewDecisionRequest = z.output<typeof reviewDecisionRequestSchema>;

export type PolicySummary = {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  policy: string;
  policyVersion: string;
};

export type ReviewDecisionOutcome =
  | {
      ok: true;
      status: number;
      decision: "approved" | "rejected" | "revised";
      pendingActionId: string;
      contentHash: string;
      executed: boolean;
      policy: PolicySummary;
    }
  | { ok: false; status: number; code: string; message: string };

type DecisionRepos = Pick<
  Repositories,
  "agentRuns" | "agentEvents" | "approvalRequests" | "auditEvents"
>;

type DecisionDeps = {
  repos: DecisionRepos;
  registry: ToolRegistry;
  gateway: ToolGateway;
  audit: AuditWriter;
};

const alreadyDecided: ReviewDecisionOutcome = {
  ok: false,
  status: 409,
  code: "ALREADY_DECIDED",
  message: "pending action is already decided",
};

/**
 * The only path from a human decision to an executed action. Approve, reject,
 * and edit all run the same guards in the same order, and execution goes
 * through the tool gateway the agent uses rather than a direct store write.
 */
export function createReviewDecisionService(deps: DecisionDeps) {
  return {
    async decide(input: {
      runId: string;
      pendingActionId: string;
      clinician: ResolvedClinician;
      request: ReviewDecisionRequest;
    }): Promise<ReviewDecisionOutcome> {
      const { runId, pendingActionId, clinician, request } = input;

      const run = await deps.repos.agentRuns.getById(runId);
      if (!run) {
        return { ok: false, status: 404, code: "RUN_NOT_FOUND", message: "agent run not found" };
      }

      const approval = await deps.repos.approvalRequests.getById(pendingActionId);
      if (!approval || approval.agentRunId !== runId) {
        return {
          ok: false,
          status: 404,
          code: "PENDING_ACTION_NOT_FOUND",
          message: "pending action not found on this run",
        };
      }

      const pending = parsePendingAction(approval);
      if (!pending) {
        return {
          ok: false,
          status: 422,
          code: "MALFORMED_PENDING_ACTION",
          message: "stored pending action does not match the expected schema",
        };
      }

      if (!clinician.authorizedPatientIds.includes(run.patientId)) {
        return {
          ok: false,
          status: 403,
          code: "PATIENT_NOT_AUTHORIZED",
          message: "actor is not authorized for this patient",
        };
      }

      // Approval binds the exact bytes the reviewer saw.
      if (pending.contentHash !== request.expectedContentHash) {
        return {
          ok: false,
          status: 409,
          code: "CONTENT_HASH_MISMATCH",
          message: "this action changed since it was displayed; reload and review it again",
        };
      }

      if (pending.status !== "pending") {
        return {
          ok: false,
          status: 409,
          code: "ALREADY_DECIDED",
          message: `pending action is already ${pending.status}`,
        };
      }

      if (request.decision === "edit") {
        return editPendingAction(deps, { run, pending, clinician, request });
      }

      const policyEngine = createAuditedPolicyEngine({
        audit: deps.audit,
        context: { agentRunId: run.id, agentName: toAgentIdentity(run.agentName) },
      });

      // Approving mints the grant the policy engine requires. Rejecting does
      // not, and a grant still cannot unlock a prohibited action.
      const approvals =
        request.decision === "approve"
          ? [
              grantHumanApproval({
                actionType: pending.policyActionType,
                patientId: run.patientId,
                approvedBy: clinician.actor.id,
                approverRole: clinician.actor.role,
              }),
            ]
          : [];

      const policy = await policyEngine.evaluateAction(
        { type: pending.policyActionType, patientId: run.patientId },
        clinician.actor,
        {
          patientId: run.patientId,
          authorizedPatientIds: clinician.authorizedPatientIds,
          approvals,
        },
      );

      if (request.decision === "reject") {
        const claimed = await deps.repos.approvalRequests.updateIfStatus(pending.id, "pending", {
          status: "rejected",
          reviewer: clinician.actor.id,
          reviewedAt: new Date(),
          reason: request.note,
        });
        if (!claimed) {
          return alreadyDecided;
        }

        await recordHumanDecision(deps, run.id, {
          decision: "rejected",
          pendingActionId: pending.id,
          actorId: clinician.actor.id,
          contentHash: pending.contentHash,
          note: request.note ?? null,
        });

        return {
          ok: true,
          status: 200,
          decision: "rejected",
          pendingActionId: pending.id,
          contentHash: pending.contentHash,
          executed: false,
          policy,
        };
      }

      if (!policy.allowed) {
        return { ok: false, status: 403, code: "POLICY_DENIED", message: policy.reason };
      }

      // Claim before execute so two concurrent approvals cannot both run the
      // tool. Zero rows means another request won the race.
      const claimed = await deps.repos.approvalRequests.updateIfStatus(pending.id, "pending", {
        status: "approved",
        reviewer: clinician.actor.id,
        reviewedAt: new Date(),
        reason: request.note,
      });
      if (!claimed) {
        return alreadyDecided;
      }

      // If a previous attempt executed and then crashed before the claim
      // persisted, do not run the tool again. Completing the claim is enough.
      if (await alreadyExecuted(deps, run.id, pending.toolName)) {
        await recordHumanDecision(deps, run.id, {
          decision: "approved",
          pendingActionId: pending.id,
          actorId: clinician.actor.id,
          contentHash: pending.contentHash,
          note: request.note ?? null,
        });
        return {
          ok: true,
          status: 200,
          decision: "approved",
          pendingActionId: pending.id,
          contentHash: pending.contentHash,
          executed: true,
          policy,
        };
      }

      let execution;
      try {
        execution = await deps.gateway.invoke(pending.toolName, pending.args, {
          actor: clinician.actor,
          agentName: toAgentIdentity(run.agentName),
          patientScope: run.patientId,
          agentRunId: run.id,
          phase: "post_approval",
        });
      } catch {
        // Uncertain whether the tool ran. Leave the claim in place so a retry
        // cannot execute a second time.
        return {
          ok: false,
          status: 500,
          code: "EXECUTION_ERROR",
          message: "tool invocation failed after the approval was claimed",
        };
      }

      if (!execution.ok) {
        // Known non-execution: release the claim so the action stays reviewable.
        await deps.repos.approvalRequests.updateIfStatus(pending.id, "approved", {
          status: "pending",
          reviewer: null,
          reviewedAt: null,
          reason: request.note,
        });
        const denied =
          execution.error.code === "UNAUTHORIZED" || execution.error.code === "POLICY_DENIED";
        return {
          ok: false,
          status: denied ? 403 : 422,
          code: execution.error.code,
          message: execution.error.message,
        };
      }

      await recordHumanDecision(deps, run.id, {
        decision: "approved",
        pendingActionId: pending.id,
        actorId: clinician.actor.id,
        contentHash: pending.contentHash,
        note: request.note ?? null,
      });

      return {
        ok: true,
        status: 200,
        decision: "approved",
        pendingActionId: pending.id,
        contentHash: pending.contentHash,
        executed: true,
        policy,
      };
    },
  };
}

export type ReviewDecisionService = ReturnType<typeof createReviewDecisionService>;

/**
 * An edit never executes. It rewrites the pending action through the tool's
 * own input schema, which changes the content hash and therefore requires a
 * fresh approval bound to the new bytes.
 */
async function editPendingAction(
  deps: DecisionDeps,
  input: {
    run: AgentRun;
    pending: ParsedPendingAction;
    clinician: ResolvedClinician;
    request: ReviewDecisionRequest;
  },
): Promise<ReviewDecisionOutcome> {
  const { run, pending, clinician, request } = input;

  if (!request.edits) {
    return { ok: false, status: 400, code: "EDITS_REQUIRED", message: "edits are required" };
  }

  const tool = deps.registry.resolve(pending.toolName);
  if (!tool) {
    return { ok: false, status: 422, code: "UNKNOWN_TOOL", message: "tool is not in the catalog" };
  }

  const merged = imposePatientScope(
    pending.args,
    { ...pending.args, ...request.edits },
    run.patientId,
  );
  const parsed = tool.inputSchema.safeParse(merged);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      message: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; "),
    };
  }

  const nextArgs = parsed.data as Record<string, unknown>;
  const nextHash = pendingActionContentHash({
    agentRunId: run.id,
    toolName: pending.toolName,
    args: nextArgs,
  });

  const updated = await deps.repos.approvalRequests.updateIfStatus(pending.id, "pending", {
    action: {
      type: pending.toolName,
      payload: {
        policyActionType: pending.policyActionType,
        args: nextArgs,
        proposal: pending.proposal,
      },
    },
    status: "pending",
    reviewer: null,
    reviewedAt: null,
    reason: request.note,
  });
  if (!updated) {
    return alreadyDecided;
  }

  await recordHumanDecision(deps, run.id, {
    decision: "revised",
    pendingActionId: pending.id,
    actorId: clinician.actor.id,
    contentHash: nextHash,
    note: request.note ?? null,
  });

  return {
    ok: true,
    status: 200,
    decision: "revised",
    pendingActionId: pending.id,
    contentHash: nextHash,
    executed: false,
    policy: {
      allowed: false,
      requiresApproval: true,
      reason: "edited action returned to pending and needs a fresh approval",
      policy: "policy.approval.revision_requires_new_approval",
      policyVersion: POLICY_VERSION,
    },
  };
}

async function alreadyExecuted(
  deps: DecisionDeps,
  agentRunId: string,
  toolName: string,
): Promise<boolean> {
  const events = await deps.repos.auditEvents.listByAgentRunId(agentRunId);
  return events.some((event) => event.outcome === "executed" && event.toolName === toolName);
}

async function recordHumanDecision(
  deps: Pick<DecisionDeps, "repos">,
  agentRunId: string,
  output: {
    decision: string;
    pendingActionId: string;
    actorId: string;
    contentHash: string;
    note: string | null;
  },
): Promise<void> {
  await deps.repos.agentEvents.create({
    agentRunId,
    eventType: "policy_decision",
    input: { kind: "human_review" },
    output: { kind: "human_decision", ...output },
  });
}

function toAgentIdentity(agentName: string): AgentIdentity {
  return (agentIdentities as readonly string[]).includes(agentName)
    ? (agentName as AgentIdentity)
    : "care_coordinator";
}
