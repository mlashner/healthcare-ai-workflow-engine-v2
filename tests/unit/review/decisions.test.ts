import { beforeEach, describe, expect, it } from "vitest";

import { parsePendingAction } from "@/approval/pending-actions";

import { clinician, createReviewHarness } from "../../helpers/review-harness";

type Harness = ReturnType<typeof createReviewHarness>;

function hashOf(harness: Harness, actionId: string): string {
  const row = harness.approvals.get(actionId);
  if (!row) {
    throw new Error(`missing approval ${actionId}`);
  }
  const parsed = parsePendingAction(row);
  if (!parsed) {
    throw new Error(`unparseable approval ${actionId}`);
  }
  return parsed.contentHash;
}

describe("review decision service", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createReviewHarness();
  });

  it("approves, executes through the gateway, and records the human decision", async () => {
    const actionId = harness.firstActionId;
    const outcome = await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician(),
      request: { decision: "approve", expectedContentHash: hashOf(harness, actionId) },
    });

    expect(outcome).toMatchObject({ ok: true, decision: "approved", executed: true });
    expect(harness.approvals.get(actionId)?.status).toBe("approved");
    expect(harness.approvals.get(actionId)?.reviewer).toBe("provider_blake");

    // The care task exists because the tool ran, not because the UI said so.
    expect(harness.careTasks).toHaveLength(1);
    expect(harness.careTasks[0]).toMatchObject({
      patientId: harness.patientId,
      status: "draft",
    });

    const executed = harness.audit.events.filter((event) => event.outcome === "executed");
    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatchObject({ toolName: "createCareTask", actorId: "provider_blake" });

    const humanDecision = harness.agentEvents.find(
      (event) => event.eventType === "policy_decision",
    );
    expect(humanDecision?.output).toMatchObject({
      kind: "human_decision",
      decision: "approved",
      actorId: "provider_blake",
    });
  });

  it("writes a policy_allowed audit event for the deciding evaluation", async () => {
    const actionId = harness.firstActionId;
    await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician(),
      request: { decision: "approve", expectedContentHash: hashOf(harness, actionId) },
    });

    expect(harness.audit.events.filter((event) => event.outcome === "policy_allowed")).toHaveLength(
      1,
    );
  });

  it("rejects without executing anything", async () => {
    const actionId = harness.firstActionId;
    const outcome = await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician(),
      request: {
        decision: "reject",
        expectedContentHash: hashOf(harness, actionId),
        note: "Follow-up already booked by phone.",
      },
    });

    expect(outcome).toMatchObject({ ok: true, decision: "rejected", executed: false });
    expect(harness.approvals.get(actionId)?.status).toBe("rejected");
    expect(harness.careTasks).toHaveLength(0);
    expect(harness.audit.events.some((event) => event.outcome === "executed")).toBe(false);
  });

  it("returns an edited action to pending under a new hash and executes nothing", async () => {
    const actionId = harness.firstActionId;
    const before = hashOf(harness, actionId);

    const outcome = await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician(),
      request: {
        decision: "edit",
        expectedContentHash: before,
        edits: { description: "Schedule a 7-day follow-up call instead." },
      },
    });

    expect(outcome).toMatchObject({ ok: true, decision: "revised", executed: false });
    expect(harness.careTasks).toHaveLength(0);
    expect(harness.approvals.get(actionId)?.status).toBe("pending");
    expect(harness.approvals.get(actionId)?.reviewer).toBeNull();

    const after = hashOf(harness, actionId);
    expect(after).not.toBe(before);
    if (outcome.ok) {
      expect(outcome.contentHash).toBe(after);
    }
  });

  it("refuses an approval that presents a stale content hash", async () => {
    const actionId = harness.firstActionId;
    const stale = hashOf(harness, actionId);

    await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician(),
      request: {
        decision: "edit",
        expectedContentHash: stale,
        edits: { description: "Revised description." },
      },
    });

    const outcome = await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician(),
      request: { decision: "approve", expectedContentHash: stale },
    });

    expect(outcome).toMatchObject({ ok: false, status: 409, code: "CONTENT_HASH_MISMATCH" });
    expect(harness.careTasks).toHaveLength(0);
  });

  it("refuses a second decision on an already decided action", async () => {
    const actionId = harness.firstActionId;
    const hash = hashOf(harness, actionId);

    await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician(),
      request: { decision: "approve", expectedContentHash: hash },
    });

    const second = await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician(),
      request: { decision: "approve", expectedContentHash: hash },
    });

    expect(second).toMatchObject({ ok: false, status: 409, code: "ALREADY_DECIDED" });
    expect(harness.careTasks).toHaveLength(1);
  });

  it("re-imposes patient scope on an edit that tries to retarget", async () => {
    const actionId = harness.firstActionId;

    await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician(),
      request: {
        decision: "edit",
        expectedContentHash: hashOf(harness, actionId),
        edits: { patientId: "patient_someone_else", description: "Retargeted." },
      },
    });

    const parsed = parsePendingAction(harness.approvals.get(actionId)!);
    expect(parsed?.args.patientId).toBe(harness.patientId);
  });

  it("rejects an edit that violates the tool's own input schema", async () => {
    const actionId = harness.firstActionId;

    const outcome = await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician(),
      request: {
        decision: "edit",
        expectedContentHash: hashOf(harness, actionId),
        edits: { priority: "catastrophic" },
      },
    });

    expect(outcome).toMatchObject({ ok: false, status: 400, code: "VALIDATION_ERROR" });
  });

  it("denies a decision on a pending action belonging to another run", async () => {
    const outcome = await harness.decisions.decide({
      runId: "run_someone_else",
      pendingActionId: harness.firstActionId,
      clinician: clinician(),
      request: { decision: "approve", expectedContentHash: hashOf(harness, harness.firstActionId) },
    });

    expect(outcome).toMatchObject({ ok: false, status: 404 });
    expect(harness.careTasks).toHaveLength(0);
  });

  it("denies an approver who is not authorized for the run's patient", async () => {
    const actionId = harness.firstActionId;
    const outcome = await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician({ authorizedPatientIds: ["patient_unrelated"] }),
      request: { decision: "approve", expectedContentHash: hashOf(harness, actionId) },
    });

    expect(outcome).toMatchObject({ ok: false, status: 403, code: "PATIENT_NOT_AUTHORIZED" });
    expect(harness.careTasks).toHaveLength(0);
  });

  it("denies an approver whose role the policy does not permit", async () => {
    const actionId = harness.firstActionId;
    const outcome = await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician({ actor: { id: "provider_patel", role: "reviewer" } }),
      request: { decision: "approve", expectedContentHash: hashOf(harness, actionId) },
    });

    expect(outcome).toMatchObject({ ok: false, status: 403, code: "POLICY_DENIED" });
    expect(harness.careTasks).toHaveLength(0);
    expect(harness.audit.events.some((event) => event.outcome === "policy_denied")).toBe(true);
  });

  it("requires a recorded approval before a send-class action may execute", async () => {
    const messaging = createReviewHarness({ proposalType: "draft_patient_message" });
    const actionId = messaging.firstActionId;

    const outcome = await messaging.decisions.decide({
      runId: messaging.runId,
      pendingActionId: actionId,
      clinician: clinician(),
      request: { decision: "approve", expectedContentHash: hashOf(messaging, actionId) },
    });

    expect(outcome).toMatchObject({ ok: true, decision: "approved", executed: true });
    if (outcome.ok) {
      expect(outcome.policy.requiresApproval).toBe(true);
    }
  });

  it("releases the claim when the gateway rejects the execution", async () => {
    const actionId = harness.firstActionId;
    const row = harness.approvals.get(actionId)!;
    const payload = row.action.payload as {
      policyActionType: string;
      args: Record<string, unknown>;
      proposal: { summary: string; rationale: string; citationIds: string[] };
    };
    payload.args.description = "";
    harness.approvals.set(actionId, { ...row, action: { ...row.action, payload } });

    const outcome = await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician(),
      request: { decision: "approve", expectedContentHash: hashOf(harness, actionId) },
    });

    expect(outcome).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(harness.approvals.get(actionId)?.status).toBe("pending");
    expect(harness.careTasks).toHaveLength(0);
  });

  describe("requestHumanApproval edits", () => {
    let messaging: Harness;

    beforeEach(() => {
      messaging = createReviewHarness({ proposalType: "request_human_approval" });
    });

    it("accepts a valid edit to the reason field", async () => {
      const actionId = messaging.firstActionId;
      const outcome = await messaging.decisions.decide({
        runId: messaging.runId,
        pendingActionId: actionId,
        clinician: clinician(),
        request: {
          decision: "edit",
          expectedContentHash: hashOf(messaging, actionId),
          edits: { reason: "Clinician revised the outreach reason." },
        },
      });

      expect(outcome).toMatchObject({ ok: true, decision: "revised", executed: false });
      const parsed = parsePendingAction(messaging.approvals.get(actionId)!);
      expect(parsed?.args.reason).toBe("Clinician revised the outreach reason.");
      expect(parsed?.args).not.toHaveProperty("patientId");
    });

    it("does not retarget through a top-level patientId edit", async () => {
      const actionId = messaging.firstActionId;
      const outcome = await messaging.decisions.decide({
        runId: messaging.runId,
        pendingActionId: actionId,
        clinician: clinician(),
        request: {
          decision: "edit",
          expectedContentHash: hashOf(messaging, actionId),
          edits: { patientId: "patient_someone_else", reason: "Retargeted." },
        },
      });

      expect(outcome).toMatchObject({ ok: true, decision: "revised" });
      const parsed = parsePendingAction(messaging.approvals.get(actionId)!);
      expect(parsed?.args).not.toHaveProperty("patientId");
      expect((parsed?.args.payload as { patientId: string }).patientId).toBe(messaging.patientId);
    });

    it("does not retarget through a nested payload patientId", async () => {
      const actionId = messaging.firstActionId;
      const outcome = await messaging.decisions.decide({
        runId: messaging.runId,
        pendingActionId: actionId,
        clinician: clinician(),
        request: {
          decision: "edit",
          expectedContentHash: hashOf(messaging, actionId),
          edits: { payload: { patientId: "patient_someone_else" } },
        },
      });

      expect(outcome).toMatchObject({ ok: true, decision: "revised" });
      const parsed = parsePendingAction(messaging.approvals.get(actionId)!);
      expect((parsed?.args.payload as { patientId: string }).patientId).toBe(messaging.patientId);
    });
  });
});
