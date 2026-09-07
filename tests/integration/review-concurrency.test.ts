import { randomBytes } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { parsePendingAction } from "@/approval/pending-actions";
import { createRepositoryAuditWriter } from "@/audit/writer";
import { resolveClinician } from "@/authz/patient-access";
import { closeDb, getDb } from "@/lib/db/client";
import { createRepositories } from "@/lib/db/repositories";
import { seedFictionalData, seedIds } from "@/lib/db/seed";
import { seedReviewFixture } from "@/lib/db/seed-review";
import { createReviewDecisionService } from "@/review/decisions";
import { createToolRegistry } from "@/tools/catalog";
import { createToolGateway } from "@/tools/gateway";

const db = getDb();
const repos = createRepositories(db);
const audit = createRepositoryAuditWriter(repos.auditEvents);
const registry = createToolRegistry(repos);
const gateway = createToolGateway({ registry, audit });
const decisions = createReviewDecisionService({ repos, registry, gateway, audit });

afterAll(async () => {
  await closeDb();
});

async function freshCareTaskAction() {
  await seedFictionalData(db);
  const run = await seedReviewFixture(db, {
    runId: `run_cas_${randomBytes(5).toString("hex")}`,
    patientId: seedIds.patients.ava,
  });
  const action = run.pendingActions.find((item) => item.toolName === "createCareTask");
  if (!action) {
    throw new Error("fixture is missing createCareTask");
  }
  const clinician = await resolveClinician(
    { providers: repos.providers, encounters: repos.encounters, careTasks: repos.careTasks },
    seedIds.providers.blake,
  );
  if (!clinician) {
    throw new Error("expected coordinator clinician");
  }
  return { run, action, clinician };
}

describe("concurrent approval", () => {
  it("lets only one of two simultaneous approvals execute", async () => {
    const { run, action, clinician } = await freshCareTaskAction();
    const beforeTasks = (await repos.careTasks.listByPatientId(seedIds.patients.ava)).length;
    const beforeAudit = (await repos.auditEvents.listByAgentRunId(run.runId)).filter(
      (event) => event.outcome === "executed" && event.toolName === "createCareTask",
    ).length;

    const request = {
      runId: run.runId,
      pendingActionId: action.id,
      clinician,
      request: { decision: "approve" as const, expectedContentHash: action.contentHash },
    };
    const results = await Promise.all([decisions.decide(request), decisions.decide(request)]);

    const successes = results.filter((result) => result.ok && result.executed);
    const conflicts = results.filter((result) => !result.ok && result.code === "ALREADY_DECIDED");

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    const afterTasks = (await repos.careTasks.listByPatientId(seedIds.patients.ava)).length;
    expect(afterTasks - beforeTasks).toBe(1);

    const executed = (await repos.auditEvents.listByAgentRunId(run.runId)).filter(
      (event) => event.outcome === "executed" && event.toolName === "createCareTask",
    );
    expect(executed.length - beforeAudit).toBe(1);
  });
});

describe("crash-window retry", () => {
  it("does not execute a second time if status was left pending after a successful run", async () => {
    const { run, action, clinician } = await freshCareTaskAction();
    const beforeTasks = (await repos.careTasks.listByPatientId(seedIds.patients.ava)).length;

    const first = await decisions.decide({
      runId: run.runId,
      pendingActionId: action.id,
      clinician,
      request: { decision: "approve", expectedContentHash: action.contentHash },
    });
    expect(first).toMatchObject({ ok: true, executed: true });

    await repos.approvalRequests.update(action.id, {
      status: "pending",
      reviewer: null,
      reviewedAt: null,
    });
    const stored = await repos.approvalRequests.getById(action.id);
    expect(stored?.status).toBe("pending");
    const retryHash = parsePendingAction(stored!)!.contentHash;

    const retry = await decisions.decide({
      runId: run.runId,
      pendingActionId: action.id,
      clinician,
      request: { decision: "approve", expectedContentHash: retryHash },
    });

    expect(retry.ok).toBe(true);
    const afterTasks = (await repos.careTasks.listByPatientId(seedIds.patients.ava)).length;
    expect(afterTasks - beforeTasks).toBe(1);

    const executed = (await repos.auditEvents.listByAgentRunId(run.runId)).filter(
      (event) => event.outcome === "executed" && event.toolName === "createCareTask",
    );
    expect(executed).toHaveLength(1);
  });
});
