import { z } from "zod";

import { entityIdSchema, type ActorRole } from "@/lib/domain";

import { findApprovalGrant, type HumanApprovalGrant } from "./approvals";

export const POLICY_VERSION = "carepilot-policy-v1";

export const policyActionTypes = [
  "create_care_task",
  "draft_patient_message",
  "send_patient_message",
  "change_medication",
  "diagnose_condition",
  "access_patient_data",
] as const;

export type PolicyActionType = (typeof policyActionTypes)[number];

/**
 * `allow` executes with no approval. `allow_pending_approval` permits the draft
 * but keeps the downstream send behind a human. `require_approval` needs a
 * recorded approval before it may proceed. `prohibit` is never permitted.
 */
export type PolicyEffect = "allow" | "allow_pending_approval" | "require_approval" | "prohibit";

export type ActionPolicy = {
  id: string;
  effect: PolicyEffect;
  roles: readonly ActorRole[];
  rationale: string;
};

const coordinationRoles = ["physician", "nurse", "care_coordinator", "social_worker"] as const;
const messagingRoles = ["physician", "nurse", "care_coordinator"] as const;
const chartReadRoles = [
  "physician",
  "nurse",
  "care_coordinator",
  "pharmacist",
  "social_worker",
  "reviewer",
] as const;

/**
 * Typed application configuration. These rules are deterministic and never
 * consult a model. Editing this table is the only way to change behavior.
 */
export const actionPolicies = {
  create_care_task: {
    id: "policy.care_task.create",
    effect: "allow",
    roles: coordinationRoles,
    rationale: "Care-coordination tasks are reversible and stay in a draft state.",
  },
  draft_patient_message: {
    id: "policy.patient_message.draft",
    effect: "allow_pending_approval",
    roles: messagingRoles,
    rationale: "Drafting is permitted, but a human must approve the message before it is sent.",
  },
  send_patient_message: {
    id: "policy.patient_message.send",
    effect: "require_approval",
    roles: messagingRoles,
    rationale: "Sending reaches a patient and requires recorded human approval.",
  },
  change_medication: {
    id: "policy.medication.change",
    effect: "prohibit",
    roles: [],
    rationale: "CarePilot never changes medication. This demo has no prescribing authority.",
  },
  diagnose_condition: {
    id: "policy.diagnosis.assert",
    effect: "prohibit",
    roles: [],
    rationale: "CarePilot never diagnoses. Clinical conclusions belong to a licensed human.",
  },
  access_patient_data: {
    id: "policy.patient_data.read",
    effect: "allow",
    roles: chartReadRoles,
    rationale: "Chart reads are permitted only inside the bound patient scope.",
  },
} as const satisfies Record<PolicyActionType, ActionPolicy>;

export const crossCuttingPolicies = {
  schema: {
    id: "policy.action.schema",
    rationale: "An action must match the typed schema exactly. Extra fields are rejected.",
  },
  defaultDeny: {
    id: "policy.default_deny",
    rationale: "Unrecognized actions are denied. The catalog is a closed set.",
  },
  patientScope: {
    id: "policy.patient_scope.same_patient_only",
    rationale: "An action may only target the patient bound to the run.",
  },
  patientAuthorization: {
    id: "policy.authorization.patient_not_authorized",
    rationale: "The actor must be authorized for the patient in the bound context.",
  },
  roleAuthorization: {
    id: "policy.authorization.role_not_permitted",
    rationale: "The actor's role must be permitted for this action type.",
  },
} as const;

/**
 * Actions may be model-proposed, so the schema is strict: it carries no
 * approval, authorization, or override fields for a model to populate.
 */
export const policyActionSchema = z
  .object({
    type: z.enum(policyActionTypes),
    patientId: entityIdSchema,
  })
  .strict();

export type PolicyAction = z.output<typeof policyActionSchema>;

export type PolicyActor = {
  id: string;
  role: ActorRole;
};

/**
 * Bound by the control plane at run creation. Never assembled from model output.
 */
export type PatientContext = {
  patientId: string;
  authorizedPatientIds: readonly string[];
  approvals?: readonly unknown[];
};

export type PolicyDecision = {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  policy: string;
  policyVersion: string;
};

export function evaluateAction(
  action: unknown,
  actor: PolicyActor,
  patientContext: PatientContext,
): PolicyDecision {
  const parsed = policyActionSchema.safeParse(action);
  if (!parsed.success) {
    return deny(
      crossCuttingPolicies.schema.id,
      `action rejected: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }

  const policy: ActionPolicy | undefined = actionPolicies[parsed.data.type];
  if (!policy) {
    return deny(crossCuttingPolicies.defaultDeny.id, crossCuttingPolicies.defaultDeny.rationale);
  }

  if (policy.effect === "prohibit") {
    return deny(policy.id, policy.rationale);
  }

  if (parsed.data.patientId !== patientContext.patientId) {
    return deny(
      crossCuttingPolicies.patientScope.id,
      crossCuttingPolicies.patientScope.rationale,
      policy.effect !== "allow",
    );
  }

  if (!patientContext.authorizedPatientIds.includes(patientContext.patientId)) {
    return deny(
      crossCuttingPolicies.patientAuthorization.id,
      crossCuttingPolicies.patientAuthorization.rationale,
      policy.effect !== "allow",
    );
  }

  if (!policy.roles.includes(actor.role)) {
    return deny(
      crossCuttingPolicies.roleAuthorization.id,
      `${crossCuttingPolicies.roleAuthorization.rationale} Role ${actor.role} cannot ${parsed.data.type}.`,
      policy.effect !== "allow",
    );
  }

  if (policy.effect === "allow") {
    return {
      allowed: true,
      requiresApproval: false,
      reason: policy.rationale,
      policy: policy.id,
      policyVersion: POLICY_VERSION,
    };
  }

  if (policy.effect === "allow_pending_approval") {
    return {
      allowed: true,
      requiresApproval: true,
      reason: policy.rationale,
      policy: policy.id,
      policyVersion: POLICY_VERSION,
    };
  }

  const grant: HumanApprovalGrant | undefined = findApprovalGrant(
    patientContext.approvals ?? [],
    parsed.data.type,
    patientContext.patientId,
  );

  if (!grant) {
    return deny(policy.id, `${policy.rationale} No recorded approval was presented.`, true);
  }

  return {
    allowed: true,
    requiresApproval: true,
    reason: `${policy.rationale} Approval recorded by ${grant.approvedBy}.`,
    policy: policy.id,
    policyVersion: POLICY_VERSION,
  };
}

function deny(policy: string, reason: string, requiresApproval = false): PolicyDecision {
  return {
    allowed: false,
    requiresApproval,
    reason,
    policy,
    policyVersion: POLICY_VERSION,
  };
}
