import { like } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { createRepositoryAuditWriter } from "@/audit/writer";
import type { ToolInvocationContext } from "@/authz/types";
import { closeDb, getDb } from "@/lib/db/client";
import { createRepositories } from "@/lib/db/repositories";
import { agentRuns, careTasks, encounters, patients, providers } from "@/lib/db/schema";
import { seedFictionalData, seedIds } from "@/lib/db/seed";
import { createToolRegistry } from "@/tools/catalog";
import { createToolGateway } from "@/tools/gateway";

const db = getDb();
const repos = createRepositories(db);
const gateway = createToolGateway({
  registry: createToolRegistry(repos),
  audit: createRepositoryAuditWriter(repos.auditEvents),
});

afterEach(async () => {
  await db.delete(agentRuns).where(like(agentRuns.id, "test_tool_%"));
  await db.delete(careTasks).where(like(careTasks.patientId, "test_tool_%"));
  await db.delete(encounters).where(like(encounters.patientId, "test_tool_%"));
  await db.delete(patients).where(like(patients.id, "test_tool_%"));
  await db.delete(providers).where(like(providers.id, "test_tool_%"));
});

afterAll(async () => {
  await closeDb();
});

function testId(label: string): string {
  return `test_tool_${label}_${crypto.randomUUID()}`;
}

async function createScopedRun(role: ToolInvocationContext["actor"]["role"] = "care_coordinator") {
  const provider = await repos.providers.create({
    id: testId("provider"),
    name: "Tool Test Provider (FICTIONAL)",
    role: role === "system" ? "care_coordinator" : role === "reviewer" ? "reviewer" : "care_coordinator",
  });
  const patient = await repos.patients.create({
    id: testId("patient"),
    name: "Tool Test Patient (FICTIONAL)",
    dateOfBirth: "1982-02-02",
    conditions: [{ name: "Hypertension" }],
    medications: [{ name: "lisinopril" }],
  });
  const other = await repos.patients.create({
    id: testId("other"),
    name: "Other Patient (FICTIONAL)",
    dateOfBirth: "1990-03-03",
  });
  const run = await repos.agentRuns.create({
    id: testId("run"),
    patientId: patient.id,
    agentName: "care_coordinator",
    status: "running",
  });

  const context: ToolInvocationContext = {
    actor: { id: provider.id, role },
    agentName: "care_coordinator",
    patientScope: patient.id,
    agentRunId: run.id,
  };

  return { provider, patient, other, run, context };
}

describe("tool gateway integration", () => {
  it("returns scoped patient context and writes an audit event", async () => {
    const { patient, context, run } = await createScopedRun();

    const result = await gateway.invoke(
      "getPatientContext",
      { patientId: patient.id },
      context,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toMatchObject({
        patientId: patient.id,
        name: "Tool Test Patient (FICTIONAL)",
      });
    }

    const audit = await repos.auditEvents.listByAgentRunId(run.id);
    expect(audit[0]).toMatchObject({
      toolName: "getPatientContext",
      outcome: "executed",
      code: "OK",
      patientScope: patient.id,
    });
  });

  it("cannot read another patient by supplying their id", async () => {
    const { other, context, run } = await createScopedRun();

    const result = await gateway.invoke(
      "getPatientContext",
      { patientId: other.id },
      context,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHORIZED");
      expect(JSON.stringify(result)).not.toContain(other.name);
    }

    const audit = await repos.auditEvents.listByAgentRunId(run.id);
    expect(audit[0]?.outcome).toBe("denied");
  });

  it("creates a draft care task bound to the scoped patient", async () => {
    const { patient, context } = await createScopedRun();

    const result = await gateway.invoke(
      "createCareTask",
      {
        patientId: patient.id,
        type: "follow_up",
        description: "Fictional follow-up from the tool layer",
      },
      context,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toMatchObject({
        patientId: patient.id,
        status: "draft",
      });
      const stored = await repos.careTasks.getById(
        (result.output as { id: string }).id,
      );
      expect(stored?.status).toBe("draft");
      expect(stored?.patientId).toBe(patient.id);
    }
  });

  it("records a pending approval and does not treat the request as authorized execution", async () => {
    const { patient, context } = await createScopedRun();

    const result = await gateway.invoke(
      "requestHumanApproval",
      {
        actionType: "propose_referral",
        payload: { patientId: patient.id, specialty: "endocrinology" },
        reason: "Fictional demo referral",
      },
      context,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.output as {
        approvalRequestId: string;
        status: string;
      };
      expect(output.status).toBe("pending");
      const stored = await repos.approvalRequests.getById(output.approvalRequestId);
      expect(stored?.status).toBe("pending");
      expect(stored?.action.payload.patientId).toBe(patient.id);
    }
  });

  it("searches the fictional knowledge base", async () => {
    await seedFictionalData(db);
    const { context } = await createScopedRun();

    const result = await gateway.invoke(
      "searchClinicalKnowledge",
      { query: "diabetes" },
      context,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.output as { results: Array<{ id: string; snippet: string }> };
      expect(output.results.some((item) => item.id === seedIds.documents.diabetesFollowUp)).toBe(
        true,
      );
      expect(output.results[0]?.snippet).toBeTruthy();
    }
  });

  it("returns recent encounters and the current care plan for the scoped patient", async () => {
    const { patient, provider, context } = await createScopedRun();
    await repos.encounters.create({
      id: testId("encounter"),
      patientId: patient.id,
      providerId: provider.id,
      transcript: "FICTIONAL ENCOUNTER for tool tests",
    });
    await repos.careTasks.create({
      id: testId("task"),
      patientId: patient.id,
      type: "care_gap",
      description: "Fictional gap",
      status: "draft",
    });

    const encountersResult = await gateway.invoke(
      "getRecentEncounters",
      { patientId: patient.id, limit: 5 },
      context,
    );
    const planResult = await gateway.invoke("getCarePlan", { patientId: patient.id }, context);

    expect(encountersResult.ok).toBe(true);
    expect(planResult.ok).toBe(true);
    if (encountersResult.ok) {
      expect(encountersResult.output).toMatchObject({ patientId: patient.id });
    }
    if (planResult.ok) {
      const output = planResult.output as { tasks: Array<{ type: string }> };
      expect(output.tasks.some((task) => task.type === "care_gap")).toBe(true);
    }
  });

  it("drafts a patient message as a reversible outreach task", async () => {
    const { patient, context } = await createScopedRun();

    const result = await gateway.invoke(
      "draftPatientMessage",
      {
        patientId: patient.id,
        purpose: "lab follow-up",
        talkingPoints: ["This is a fictional draft.", "It must not be sent automatically."],
      },
      context,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.output as { careTaskId: string; status: string; body: string };
      expect(output.status).toBe("draft");
      expect(output.body).toContain("FICTIONAL DRAFT");
      const stored = await repos.careTasks.getById(output.careTaskId);
      expect(stored?.type).toBe("outreach");
      expect(stored?.status).toBe("draft");
    }
  });
});
