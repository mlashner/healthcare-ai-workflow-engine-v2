import { describe, expect, it } from "vitest";

import {
  evaluateAction,
  grantHumanApproval,
  POLICY_VERSION,
  type PatientContext,
  type PolicyActor,
} from "@/policy";

const patientId = "patient_in_scope";
const coordinator: PolicyActor = { id: "provider_1", role: "care_coordinator" };

function context(overrides: Partial<PatientContext> = {}): PatientContext {
  return {
    patientId,
    authorizedPatientIds: [patientId],
    ...overrides,
  };
}

describe("evaluateAction: care-coordination task", () => {
  it("allows a care task with no approval required", () => {
    const decision = evaluateAction({ type: "create_care_task", patientId }, coordinator, context());

    expect(decision).toMatchObject({
      allowed: true,
      requiresApproval: false,
      policy: "policy.care_task.create",
      policyVersion: POLICY_VERSION,
    });
    expect(decision.reason).toMatch(/reversible/i);
  });
});

describe("evaluateAction: patient messages", () => {
  it("allows drafting but flags that approval is required before sending", () => {
    const decision = evaluateAction(
      { type: "draft_patient_message", patientId },
      coordinator,
      context(),
    );

    expect(decision).toMatchObject({
      allowed: true,
      requiresApproval: true,
      policy: "policy.patient_message.draft",
    });
  });

  it("denies sending when no approval has been recorded", () => {
    const decision = evaluateAction(
      { type: "send_patient_message", patientId },
      coordinator,
      context(),
    );

    expect(decision).toMatchObject({
      allowed: false,
      requiresApproval: true,
      policy: "policy.patient_message.send",
    });
    expect(decision.reason).toMatch(/no recorded approval/i);
  });

  it("allows sending once a human approval grant is presented", () => {
    const approval = grantHumanApproval({
      actionType: "send_patient_message",
      patientId,
      approvedBy: "provider_reviewer",
      approverRole: "physician",
    });

    const decision = evaluateAction({ type: "send_patient_message", patientId }, coordinator, {
      ...context(),
      approvals: [approval],
    });

    expect(decision).toMatchObject({ allowed: true, requiresApproval: true });
    expect(decision.reason).toMatch(/provider_reviewer/);
  });

  it("does not reuse an approval across action types or patients", () => {
    const approval = grantHumanApproval({
      actionType: "send_patient_message",
      patientId: "patient_other",
      approvedBy: "provider_reviewer",
      approverRole: "physician",
    });

    const decision = evaluateAction({ type: "send_patient_message", patientId }, coordinator, {
      ...context(),
      approvals: [approval],
    });

    expect(decision.allowed).toBe(false);
  });
});

describe("evaluateAction: prohibited actions", () => {
  it("prohibits changing medication for every role", () => {
    for (const role of ["physician", "nurse", "care_coordinator", "pharmacist"] as const) {
      const decision = evaluateAction(
        { type: "change_medication", patientId },
        { id: "provider_1", role },
        context(),
      );

      expect(decision).toMatchObject({
        allowed: false,
        policy: "policy.medication.change",
      });
    }
  });

  it("prohibits diagnosing a condition for every role", () => {
    for (const role of ["physician", "nurse", "care_coordinator"] as const) {
      const decision = evaluateAction(
        { type: "diagnose_condition", patientId },
        { id: "provider_1", role },
        context(),
      );

      expect(decision).toMatchObject({
        allowed: false,
        policy: "policy.diagnosis.assert",
      });
    }
  });

  it("prohibits a medication change even with a matching approval grant", () => {
    const approval = grantHumanApproval({
      actionType: "change_medication",
      patientId,
      approvedBy: "provider_reviewer",
      approverRole: "physician",
    });

    const decision = evaluateAction({ type: "change_medication", patientId }, coordinator, {
      ...context(),
      approvals: [approval],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.policy).toBe("policy.medication.change");
  });
});

describe("evaluateAction: patient scope and authorization", () => {
  it("prohibits reading another patient's data", () => {
    const decision = evaluateAction(
      { type: "access_patient_data", patientId: "patient_other" },
      coordinator,
      context(),
    );

    expect(decision).toMatchObject({
      allowed: false,
      policy: "policy.patient_scope.same_patient_only",
    });
  });

  it("prohibits any action aimed at a patient outside the bound scope", () => {
    const decision = evaluateAction(
      { type: "create_care_task", patientId: "patient_other" },
      coordinator,
      context(),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.policy).toBe("policy.patient_scope.same_patient_only");
  });

  it("prohibits access when the actor is not authorized for the bound patient", () => {
    const decision = evaluateAction(
      { type: "access_patient_data", patientId },
      coordinator,
      context({ authorizedPatientIds: [] }),
    );

    expect(decision).toMatchObject({
      allowed: false,
      policy: "policy.authorization.patient_not_authorized",
    });
  });

  it("prohibits an action the actor's role may not perform", () => {
    const decision = evaluateAction({ type: "create_care_task", patientId }, {
      id: "reviewer_1",
      role: "reviewer",
    }, context());

    expect(decision).toMatchObject({
      allowed: false,
      policy: "policy.authorization.role_not_permitted",
    });
    expect(decision.reason).toMatch(/reviewer/);
  });

  it("prohibits system actors from coordination actions", () => {
    const decision = evaluateAction({ type: "create_care_task", patientId }, {
      id: "system",
      role: "system",
    }, context());

    expect(decision.allowed).toBe(false);
  });

  it("allows an in-scope chart read for a permitted role", () => {
    const decision = evaluateAction({ type: "access_patient_data", patientId }, coordinator, context());

    expect(decision).toMatchObject({ allowed: true, requiresApproval: false });
  });
});

describe("evaluateAction: closed action set", () => {
  it("denies an action type that is not in the catalog", () => {
    const decision = evaluateAction({ type: "prescribe_medication", patientId }, coordinator, context());

    expect(decision).toMatchObject({ allowed: false, policy: "policy.action.schema" });
  });

  it("denies malformed and non-object actions", () => {
    for (const action of [null, undefined, "create_care_task", 42, []]) {
      expect(evaluateAction(action, coordinator, context()).allowed).toBe(false);
    }
  });

  it("stamps every decision with a policy id and version", () => {
    const decisions = [
      evaluateAction({ type: "create_care_task", patientId }, coordinator, context()),
      evaluateAction({ type: "change_medication", patientId }, coordinator, context()),
      evaluateAction({ type: "nonsense" }, coordinator, context()),
    ];

    for (const decision of decisions) {
      expect(decision.policy.length).toBeGreaterThan(0);
      expect(decision.policyVersion).toBe(POLICY_VERSION);
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });
});
