import type { AuditWriter } from "@/audit/writer";
import type { AgentIdentity } from "@/lib/domain";
import { redact } from "@/lib/logger";

import {
  evaluateAction,
  policyActionSchema,
  type PatientContext,
  type PolicyActor,
  type PolicyDecision,
} from "./action-policy";

export type PolicyAuditContext = {
  agentRunId: string;
  agentName: AgentIdentity;
};

/**
 * Wraps the deterministic engine so every evaluation lands in the append-only
 * audit log, allows included. The decision is computed first and recorded
 * verbatim; the audit writer cannot change the outcome.
 */
export function createAuditedPolicyEngine(deps: {
  audit: AuditWriter;
  context: PolicyAuditContext;
}) {
  return {
    async evaluateAction(
      action: unknown,
      actor: PolicyActor,
      patientContext: PatientContext,
    ): Promise<PolicyDecision> {
      const decision = evaluateAction(action, actor, patientContext);

      await deps.audit.record({
        agentRunId: deps.context.agentRunId,
        toolName: policyActionName(action),
        outcome: decision.allowed ? "policy_allowed" : "policy_denied",
        code: decision.policy,
        message: decision.reason,
        actorId: actor.id,
        agentName: deps.context.agentName,
        patientScope: patientContext.patientId,
        input: redact(action),
        details: {
          allowed: decision.allowed,
          requiresApproval: decision.requiresApproval,
          policyVersion: decision.policyVersion,
          actorRole: actor.role,
        },
      });

      return decision;
    },
  };
}

export type AuditedPolicyEngine = ReturnType<typeof createAuditedPolicyEngine>;

function policyActionName(action: unknown): string {
  const parsed = policyActionSchema.safeParse(action);
  return parsed.success ? parsed.data.type : "unknown_action";
}
