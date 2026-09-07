import { describe, expect, it } from "vitest";

import { createInMemoryAuditWriter } from "@/audit/writer";
import { createAuditedPolicyEngine, POLICY_VERSION, type PatientContext } from "@/policy";

const patientId = "patient_in_scope";
const coordinator = { id: "provider_1", role: "care_coordinator" } as const;

function context(): PatientContext {
  return { patientId, authorizedPatientIds: [patientId] };
}

function createEngine() {
  const audit = createInMemoryAuditWriter();
  const engine = createAuditedPolicyEngine({
    audit,
    context: { agentRunId: "run_1", agentName: "care_coordinator" },
  });
  return { engine, audit };
}

describe("audited policy engine", () => {
  it("records an audit event when an action is allowed", async () => {
    const { engine, audit } = createEngine();

    const decision = await engine.evaluateAction(
      { type: "create_care_task", patientId },
      coordinator,
      context(),
    );

    expect(decision.allowed).toBe(true);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      agentRunId: "run_1",
      toolName: "create_care_task",
      outcome: "policy_allowed",
      code: "policy.care_task.create",
      actorId: "provider_1",
      agentName: "care_coordinator",
      patientScope: patientId,
      details: {
        allowed: true,
        requiresApproval: false,
        policyVersion: POLICY_VERSION,
        actorRole: "care_coordinator",
      },
    });
  });

  it("records an audit event when an action is denied", async () => {
    const { engine, audit } = createEngine();

    await engine.evaluateAction({ type: "change_medication", patientId }, coordinator, context());

    expect(audit.events[0]).toMatchObject({
      toolName: "change_medication",
      outcome: "policy_denied",
      code: "policy.medication.change",
      details: { allowed: false },
    });
  });

  it("audits an unrecognized action without trusting its shape", async () => {
    const { engine, audit } = createEngine();

    await engine.evaluateAction(
      { type: "exfiltrate_chart", patientId, approved: true },
      coordinator,
      context(),
    );

    expect(audit.events[0]).toMatchObject({
      toolName: "unknown_action",
      outcome: "policy_denied",
      code: "policy.action.schema",
    });
  });

  it("writes one audit event per evaluation, including repeats", async () => {
    const { engine, audit } = createEngine();

    await engine.evaluateAction({ type: "create_care_task", patientId }, coordinator, context());
    await engine.evaluateAction({ type: "send_patient_message", patientId }, coordinator, context());
    await engine.evaluateAction({ type: "create_care_task", patientId }, coordinator, context());

    expect(audit.events).toHaveLength(3);
    expect(audit.events.map((event) => event.outcome)).toEqual([
      "policy_allowed",
      "policy_denied",
      "policy_allowed",
    ]);
  });

  it("redacts demographics that ride along on an action", async () => {
    const { engine, audit } = createEngine();

    await engine.evaluateAction(
      { type: "create_care_task", patientId, name: "Ava Nguyen (FICTIONAL)" },
      coordinator,
      context(),
    );

    expect(JSON.stringify(audit.events[0]?.input)).not.toContain("Ava Nguyen");
  });
});
