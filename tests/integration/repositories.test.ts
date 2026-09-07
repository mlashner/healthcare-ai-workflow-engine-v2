import { like } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/lib/db/client";
import { createRepositories } from "@/lib/db/repositories";
import {
  agentRuns,
  careTasks,
  clinicalDocuments,
  encounters,
  patients,
  providers,
} from "@/lib/db/schema";
import { seedFictionalData, seedIds } from "@/lib/db/seed";

const db = getDb();
const repos = createRepositories(db);

afterEach(async () => {
  await db.delete(agentRuns).where(like(agentRuns.id, "test_%"));
  await db.delete(careTasks).where(like(careTasks.id, "test_%"));
  await db.delete(encounters).where(like(encounters.id, "test_%"));
  await db.delete(clinicalDocuments).where(like(clinicalDocuments.id, "test_%"));
  await db.delete(patients).where(like(patients.id, "test_%"));
  await db.delete(providers).where(like(providers.id, "test_%"));
});

afterAll(async () => {
  await closeDb();
});

function testId(label: string): string {
  return `test_${label}_${crypto.randomUUID()}`;
}

async function createChart() {
  const provider = await repos.providers.create({
    id: testId("provider"),
    name: "Dr. Test Provider (FICTIONAL)",
    role: "physician",
  });
  const coordinator = await repos.providers.create({
    id: testId("coordinator"),
    name: "Test Coordinator (FICTIONAL)",
    role: "care_coordinator",
  });
  const patient = await repos.patients.create({
    id: testId("patient"),
    name: "Test Patient (FICTIONAL)",
    dateOfBirth: "1984-04-12",
    conditions: [{ name: "Hypertension" }],
    medications: [{ name: "lisinopril", dosage: "10 mg" }],
  });

  return { provider, coordinator, patient };
}

describe("patient repository", () => {
  it("creates and reads a patient including jsonb lists", async () => {
    const created = await repos.patients.create({
      id: testId("patient"),
      name: "Jamie Cole (FICTIONAL)",
      dateOfBirth: "1988-09-09",
      conditions: [{ name: "Asthma", notes: "Fictional" }],
      medications: [{ name: "albuterol" }],
    });

    const loaded = await repos.patients.getById(created.id);

    expect(loaded).toMatchObject({
      id: created.id,
      name: "Jamie Cole (FICTIONAL)",
      dateOfBirth: "1988-09-09",
      conditions: [{ name: "Asthma", notes: "Fictional" }],
      medications: [{ name: "albuterol" }],
    });
    expect(loaded?.createdAt).toBeInstanceOf(Date);
  });

  it("updates mutable fields and touches updatedAt", async () => {
    const created = await repos.patients.create({
      id: testId("patient"),
      name: "Original Name (FICTIONAL)",
      dateOfBirth: "1970-01-01",
    });

    const updated = await repos.patients.update(created.id, {
      name: "Updated Name (FICTIONAL)",
      conditions: [{ name: "Type 2 diabetes mellitus" }],
    });

    expect(updated?.name).toBe("Updated Name (FICTIONAL)");
    expect(updated?.conditions).toEqual([{ name: "Type 2 diabetes mellitus" }]);
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it("returns null for an unknown id", async () => {
    expect(await repos.patients.getById("test_missing_patient")).toBeNull();
  });
});

describe("provider and encounter repositories", () => {
  it("persists an encounter bound to patient and provider", async () => {
    const { patient, provider } = await createChart();

    const encounter = await repos.encounters.create({
      id: testId("encounter"),
      patientId: patient.id,
      providerId: provider.id,
      transcript: "FICTIONAL ENCOUNTER — repository test.",
      occurredAt: new Date("2026-09-01T12:00:00.000Z"),
    });

    const listed = await repos.encounters.listByPatientId(patient.id);

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: encounter.id,
      patientId: patient.id,
      providerId: provider.id,
      transcript: expect.stringContaining("FICTIONAL"),
    });
  });

  it("rejects an encounter for an unknown patient", async () => {
    const provider = await repos.providers.create({
      id: testId("provider"),
      name: "Solo Provider (FICTIONAL)",
      role: "nurse",
    });

    await expect(
      repos.encounters.create({
        id: testId("encounter"),
        patientId: "test_missing_patient",
        providerId: provider.id,
        transcript: "should fail",
      }),
    ).rejects.toThrow();
  });
});

describe("clinical document repository", () => {
  it("stores a fictional knowledge-base document", async () => {
    const document = await repos.clinicalDocuments.create({
      id: testId("document"),
      title: "Fictional outreach policy",
      content: "DEMO ONLY",
      source: "policy",
    });

    const loaded = await repos.clinicalDocuments.getById(document.id);
    expect(loaded).toMatchObject({
      title: "Fictional outreach policy",
      source: "policy",
      version: "1",
    });
  });
});

describe("care task repository", () => {
  it("creates a task assigned to a provider and lists it by patient", async () => {
    const { patient, coordinator } = await createChart();

    const task = await repos.careTasks.create({
      id: testId("task"),
      patientId: patient.id,
      type: "outreach",
      description: "Fictional outreach",
      assignedTo: coordinator.id,
    });

    expect(task.status).toBe("draft");
    expect(task.priority).toBe("medium");
    expect(task.assignedTo).toBe(coordinator.id);

    const updated = await repos.careTasks.update(task.id, { status: "pending_approval" });
    expect(updated?.status).toBe("pending_approval");

    const listed = await repos.careTasks.listByPatientId(patient.id);
    expect(listed.map((row) => row.id)).toContain(task.id);
  });

  it("rejects a task assigned to an unknown provider", async () => {
    const { patient } = await createChart();

    await expect(
      repos.careTasks.create({
        id: testId("task"),
        patientId: patient.id,
        type: "referral",
        description: "should fail",
        assignedTo: "test_missing_provider",
      }),
    ).rejects.toThrow();
  });
});

describe("agent run, event, and approval repositories", () => {
  it("records a run, events, and a pending approval", async () => {
    const { patient } = await createChart();

    const run = await repos.agentRuns.create({
      id: testId("run"),
      patientId: patient.id,
      agentName: "care_coordinator",
    });

    const event = await repos.agentEvents.create({
      id: testId("event"),
      agentRunId: run.id,
      eventType: "tool_call",
      toolName: "retrieve_patient_context",
      input: { patientId: patient.id },
      output: { ok: true },
    });

    const approval = await repos.approvalRequests.create({
      id: testId("approval"),
      agentRunId: run.id,
      action: { type: "propose_referral", payload: { specialty: "endocrinology" } },
    });

    expect(run.status).toBe("queued");
    expect(event.toolName).toBe("retrieve_patient_context");
    expect(approval.status).toBe("pending");
    expect(approval.action.payload).toEqual({ specialty: "endocrinology" });

    const completed = await repos.agentRuns.update(run.id, {
      status: "completed",
      completedAt: new Date("2026-09-01T12:00:10.000Z"),
    });
    expect(completed?.status).toBe("completed");
    expect(completed?.completedAt).toBeInstanceOf(Date);

    expect(await repos.agentEvents.listByAgentRunId(run.id)).toHaveLength(1);
    expect(await repos.approvalRequests.listByAgentRunId(run.id)).toHaveLength(1);
    expect(await repos.agentRuns.listByPatientId(patient.id)).toHaveLength(1);
  });

  it("rejects an event for an unknown agent run", async () => {
    await expect(
      repos.agentEvents.create({
        id: testId("event"),
        agentRunId: "test_missing_run",
        eventType: "think",
      }),
    ).rejects.toThrow();
  });

  it("cascades agent events and approvals when a run is deleted", async () => {
    const { patient } = await createChart();
    const run = await repos.agentRuns.create({
      id: testId("run"),
      patientId: patient.id,
      agentName: "care_coordinator",
    });

    await repos.agentEvents.create({
      id: testId("event"),
      agentRunId: run.id,
      eventType: "finish",
    });
    await repos.approvalRequests.create({
      id: testId("approval"),
      agentRunId: run.id,
      action: { type: "schedule_outreach" },
    });

    await db.delete(agentRuns).where(like(agentRuns.id, run.id));

    expect(await repos.agentEvents.listByAgentRunId(run.id)).toEqual([]);
    expect(await repos.approvalRequests.listByAgentRunId(run.id)).toEqual([]);
    expect(await repos.agentRuns.getById(run.id)).toBeNull();
  });
});

describe("fictional seed data", () => {
  it("upserts a complete fictional demonstration graph", async () => {
    await seedFictionalData(db);

    const ava = await repos.patients.getById(seedIds.patients.ava);
    const encounter = await repos.encounters.getById(seedIds.encounters.avaFollowUp);
    const document = await repos.clinicalDocuments.getById(seedIds.documents.diabetesFollowUp);
    const task = await repos.careTasks.getById(seedIds.careTasks.avaFollowUp);
    const run = await repos.agentRuns.getById(seedIds.agentRuns.avaCoordinator);
    const approval = await repos.approvalRequests.getById(seedIds.approvals.avaReferral);

    expect(ava?.name).toContain("FICTIONAL");
    expect(ava?.conditions.map((item) => item.name)).toContain("Type 2 diabetes mellitus");
    expect(encounter?.patientId).toBe(seedIds.patients.ava);
    expect(document?.content).toContain("DEMO ONLY");
    expect(task?.status).toBe("pending_approval");
    expect(run?.agentName).toBe("care_coordinator");
    expect(approval?.action.type).toBe("propose_referral");
    expect(approval?.status).toBe("pending");
  });
});
