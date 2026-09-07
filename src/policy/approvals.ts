const grants = new WeakSet<object>();

export type HumanApprovalGrant = {
  readonly actionType: string;
  readonly patientId: string;
  readonly approvedBy: string;
};

/**
 * The only supported way to present a human approval to the policy engine.
 * Grants are branded, so a model-authored `{ actionType, patientId }` object
 * is not treated as an approval. Durable approval records (pending actions and
 * content hashes) belong in `src/approval/` and are out of scope here.
 */
export function grantHumanApproval(input: {
  actionType: string;
  patientId: string;
  approvedBy: string;
  approverRole: string;
}): HumanApprovalGrant {
  if (input.approverRole === "system") {
    throw new Error("system actors cannot approve an action on a human's behalf");
  }

  const grant = Object.freeze({
    actionType: input.actionType,
    patientId: input.patientId,
    approvedBy: input.approvedBy,
  });
  grants.add(grant);
  return grant;
}

export function isHumanApprovalGrant(value: unknown): value is HumanApprovalGrant {
  return typeof value === "object" && value !== null && grants.has(value);
}

export function findApprovalGrant(
  candidates: readonly unknown[],
  actionType: string,
  patientId: string,
): HumanApprovalGrant | undefined {
  return candidates.filter(isHumanApprovalGrant).find(
    (grant) => grant.actionType === actionType && grant.patientId === patientId,
  );
}
