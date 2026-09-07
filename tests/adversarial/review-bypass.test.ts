import { describe, expect, it } from "vitest";

import { parsePendingAction } from "@/approval/pending-actions";
import { reviewDecisionRequestSchema } from "@/review/decisions";

import { clinician, createReviewHarness } from "../helpers/review-harness";

type Harness = ReturnType<typeof createReviewHarness>;

function hashOf(harness: Harness, actionId: string): string {
  const parsed = parsePendingAction(harness.approvals.get(actionId)!);
  if (!parsed) {
    throw new Error("unparseable approval");
  }
  return parsed.contentHash;
}

/**
 * These tests treat the browser as hostile. The request body is the only thing
 * a modified frontend controls, so each case supplies a body that would grant
 * itself something and asserts the server ignored or refused it.
 */
describe("a hostile frontend cannot bypass the backend", () => {
  it("strips a body that tries to name its own tool, arguments, or actor", () => {
    const parsed = reviewDecisionRequestSchema.safeParse({
      decision: "approve",
      expectedContentHash: "0".repeat(64),
      toolName: "createCareTask",
      args: { patientId: "patient_someone_else" },
      actor: { id: "provider_admin", role: "physician" },
      patientId: "patient_someone_else",
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses a body that asserts the policy already allowed it", () => {
    const parsed = reviewDecisionRequestSchema.safeParse({
      decision: "approve",
      expectedContentHash: "0".repeat(64),
      policy: { allowed: true, requiresApproval: false },
      approved: true,
      bypassPolicy: true,
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses a decision verb outside the closed set", () => {
    expect(
      reviewDecisionRequestSchema.safeParse({
        decision: "execute",
        expectedContentHash: "0".repeat(64),
      }).success,
    ).toBe(false);
  });

  it("executes the stored arguments, not the ones the client last displayed", async () => {
    const harness = createReviewHarness();
    const actionId = harness.firstActionId;

    // The client "displays" one thing and approves the hash it saw. The server
    // reads the row, so only the stored description can reach the tool.
    await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician(),
      request: { decision: "approve", expectedContentHash: hashOf(harness, actionId) },
    });

    expect(harness.careTasks[0]?.description).toBe("Schedule a 14-day follow-up call.");
  });

  it("cannot approve an action for a patient outside the run's bound scope", async () => {
    const harness = createReviewHarness({
      patientId: "patient_target",
      runPatientId: "patient_bound",
    });
    const actionId = harness.firstActionId;

    const outcome = await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician({ authorizedPatientIds: ["patient_bound", "patient_target"] }),
      request: { decision: "approve", expectedContentHash: hashOf(harness, actionId) },
    });

    expect(outcome.ok).toBe(false);
    expect(harness.careTasks).toHaveLength(0);
  });

  it("leaves the action pending when the gateway refuses the execution", async () => {
    const harness = createReviewHarness();
    const actionId = harness.firstActionId;

    // A pharmacist passes the action policy for care tasks but is outside the
    // tool policy's role list for the write, so the gateway is the last stop.
    const outcome = await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician({ actor: { id: "provider_pharm", role: "pharmacist" } }),
      request: { decision: "approve", expectedContentHash: hashOf(harness, actionId) },
    });

    expect(outcome.ok).toBe(false);
    expect(harness.approvals.get(actionId)?.status).toBe("pending");
    expect(harness.careTasks).toHaveLength(0);
  });

  it("never marks an approval approved unless the tool actually ran", async () => {
    const harness = createReviewHarness();
    const actionId = harness.firstActionId;

    await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician({ actor: { id: "provider_patel", role: "reviewer" } }),
      request: { decision: "approve", expectedContentHash: hashOf(harness, actionId) },
    });

    expect(harness.approvals.get(actionId)?.status).toBe("pending");
    expect(harness.audit.events.some((event) => event.outcome === "executed")).toBe(false);
  });

  it("keeps every refused attempt visible in the audit log", async () => {
    const harness = createReviewHarness();
    const actionId = harness.firstActionId;

    await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician({ actor: { id: "provider_patel", role: "reviewer" } }),
      request: { decision: "approve", expectedContentHash: hashOf(harness, actionId) },
    });

    const denied = harness.audit.events.find((event) => event.outcome === "policy_denied");
    expect(denied).toBeDefined();
    expect(denied).toMatchObject({
      agentRunId: harness.runId,
      actorId: "provider_patel",
      patientScope: harness.patientId,
    });
  });

  it("cannot replay a decision after an edit changed the bytes", async () => {
    const harness = createReviewHarness();
    const actionId = harness.firstActionId;
    const captured = hashOf(harness, actionId);

    await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician(),
      request: {
        decision: "edit",
        expectedContentHash: captured,
        edits: { description: "A materially different task." },
      },
    });

    const replay = await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician(),
      request: { decision: "approve", expectedContentHash: captured },
    });

    expect(replay).toMatchObject({ code: "CONTENT_HASH_MISMATCH" });
    expect(harness.careTasks).toHaveLength(0);
  });

  it("refuses to execute a tampered stored row instead of coercing it", async () => {
    const harness = createReviewHarness();
    const actionId = harness.firstActionId;
    const row = harness.approvals.get(actionId)!;

    harness.approvals.set(actionId, {
      ...row,
      action: {
        type: "createCareTask",
        payload: {
          policyActionType: "create_care_task",
          args: { patientId: harness.patientId },
          proposal: { summary: "s", rationale: "r", citationIds: [] },
          forceExecute: true,
        },
      },
    });

    const outcome = await harness.decisions.decide({
      runId: harness.runId,
      pendingActionId: actionId,
      clinician: clinician(),
      request: { decision: "approve", expectedContentHash: "0".repeat(64) },
    });

    expect(outcome).toMatchObject({ ok: false, code: "MALFORMED_PENDING_ACTION" });
    expect(harness.careTasks).toHaveLength(0);
  });
});
