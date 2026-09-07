import { like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createCareCoordinatorRunner } from "@/agents/care-coordinator";
import type { CareCoordinatorResult } from "@/agents/care-coordinator";
import { createRepositoryAuditWriter } from "@/audit/writer";
import { closeDb, getDb } from "@/lib/db/client";
import { createRepositories } from "@/lib/db/repositories";
import { agentRuns, careTasks, encounters, patients, providers } from "@/lib/db/schema";
import { createScriptedModelProvider } from "@/llm";
import type { ModelMessage } from "@/llm";
import { bindRunSession } from "@/runs";
import { formatCitationId } from "@/retrieval/citations";
import { seedFictionalData } from "@/lib/db/seed";
import { createToolRegistry } from "@/tools/catalog";
import { createToolGateway } from "@/tools/gateway";

const db = getDb();
const repos = createRepositories(db);
const gateway = createToolGateway({
  registry: createToolRegistry(repos),
  audit: createRepositoryAuditWriter(repos.auditEvents),
});

const citationId = formatCitationId("kb_diabetes_followup", 0);

beforeAll(async () => {
  await seedFictionalData(db);
});

afterEach(async () => {
  await db.delete(agentRuns).where(like(agentRuns.patientId, "test_agent_%"));
  await db.delete(careTasks).where(like(careTasks.patientId, "test_agent_%"));
  await db.delete(encounters).where(like(encounters.patientId, "test_agent_%"));
  await db.delete(patients).where(like(patients.id, "test_agent_%"));
  await db.delete(providers).where(like(providers.id, "test_agent_%"));
});

afterAll(async () => {
  await closeDb();
});

function testId(label: string): string {
  return `test_agent_${label}_${crypto.randomUUID()}`;
}

function citedResult(citationId: string): CareCoordinatorResult {
  return {
    summary: "Fictional follow-up coordination may be needed after the unplanned visit.",
    identifiedConcerns: [
      {
        title: "Diabetes follow-up window",
        description: "The fictional encounter mentioned an unplanned visit and pending labs.",
        urgency: "medium",
        citationIds: [citationId],
      },
    ],
    urgency: "medium",
    reasoning: "Retrieved demo guidance supports coordination follow-up. This is not a diagnosis.",
    evidence: [
      {
        kind: "retrieved",
        text: "Demo snippet about diabetes follow-up after an unplanned visit.",
        citationId,
        toolName: "searchClinicalKnowledge",
      },
      {
        kind: "inferred",
        text: "A human coordinator should confirm whether outreach is still open.",
      },
    ],
    proposedActions: [
      {
        type: "create_care_task",
        summary: "Draft a follow-up care task for human review.",
        rationale: "Keep the action reversible and non-autonomous.",
        citationIds: [citationId],
        executedInRun: false,
      },
    ],
    requiresHumanReview: true,
    confidence: 0.72,
    uncertainty: { isUncertain: false, reasons: [] },
  };
}

function uncertainResult(): CareCoordinatorResult {
  return {
    summary: "Fictional review only. No coordination issue can be confirmed.",
    identifiedConcerns: [],
    urgency: "none",
    reasoning: "A tool failed and remaining evidence is insufficient. This is not a diagnosis.",
    evidence: [],
    proposedActions: [],
    requiresHumanReview: true,
    confidence: 0.2,
    uncertainty: { isUncertain: true, reasons: ["A retrieval tool failed."] },
  };
}

async function createFixture() {
  const provider = await repos.providers.create({
    id: testId("provider"),
    name: "Agent Test Provider (FICTIONAL)",
    role: "care_coordinator",
  });
  const patient = await repos.patients.create({
    id: testId("patient"),
    name: "Agent Test Patient (FICTIONAL)",
    dateOfBirth: "1978-06-21",
    conditions: [{ name: "Type 2 diabetes mellitus", notes: "Fictional problem list entry" }],
    medications: [{ name: "metformin", dosage: "500 mg", frequency: "twice daily" }],
  });
  const encounter = await repos.encounters.create({
    id: testId("encounter"),
    patientId: patient.id,
    providerId: provider.id,
    occurredAt: new Date("2026-08-28T15:10:00.000Z"),
    transcript: [
      "FICTIONAL ENCOUNTER — not a real patient visit.",
      "Provider: This is a scheduled follow-up after last week's unplanned clinic visit.",
      "Patient: The dizziness is better. I have been taking metformin as written.",
    ].join("\n"),
  });

  return { provider, patient, encounter };
}

describe("care coordinator integration", () => {
  it("runs the bounded loop through the gateway and persists the trace", async () => {
    const { provider, patient, encounter } = await createFixture();
    const runner = createCareCoordinatorRunner({
      model: createScriptedModelProvider([
        { type: "think", thought: "Gather fictional chart context before proposing anything." },
        {
          type: "tool_call",
          toolName: "getPatientContext",
          arguments: { patientId: patient.id },
        },
        {
          type: "tool_call",
          toolName: "getRecentEncounters",
          arguments: { patientId: patient.id },
        },
        {
          type: "tool_call",
          toolName: "getCarePlan",
          arguments: { patientId: patient.id },
        },
        {
          type: "tool_call",
          toolName: "searchClinicalKnowledge",
          arguments: { query: "diabetes follow-up after an unplanned clinic visit" },
        },
        {
          type: "tool_call",
          toolName: "createCareTask",
          arguments: {
            patientId: patient.id,
            type: "follow_up",
            description: "Fictional draft follow-up after an unplanned visit.",
            priority: "medium",
          },
        },
        (messages: ModelMessage[]) => {
          const encoded = JSON.stringify(messages);
          const match = /cite:[A-Za-z0-9_-]+:\d+/.exec(encoded);
          return { type: "finish", result: citedResult(match?.[0] ?? citationId) };
        },
      ]),
      gateway,
      runs: repos.agentRuns,
      events: repos.agentEvents,
    });

    const outcome = await runner.run({
      session: bindRunSession({
        actor: { id: provider.id, role: "care_coordinator" },
        patientId: patient.id,
        allowedPatientIds: [patient.id],
      }),
      agentRunId: testId("run"),
      encounter: {
        id: encounter.id,
        transcript: encounter.transcript,
        occurredAt: encounter.occurredAt,
      },
    });

    expect(outcome.ok, !outcome.ok ? `${outcome.code}: ${outcome.message}` : "").toBe(true);
    if (!outcome.ok) {
      throw new Error(outcome.message);
    }

    expect(outcome.result.identifiedConcerns[0]?.citationIds[0]).toMatch(
      /^cite:kb_diabetes_followup:\d+$/,
    );
    expect(outcome.result.evidence.some((item) => item.kind === "retrieved")).toBe(true);
    expect(outcome.result.evidence.some((item) => item.kind === "inferred")).toBe(true);
    expect(outcome.result.requiresHumanReview).toBe(true);
    expect(outcome.result.proposedActions[0]?.executedInRun).toBe(false);

    const persisted = await repos.agentRuns.getById(outcome.runId);
    expect(persisted?.status).toBe("completed");
    expect(persisted?.patientId).toBe(patient.id);

    const events = await repos.agentEvents.listByAgentRunId(outcome.runId);
    expect(events.some((event) => event.eventType === "think")).toBe(true);
    expect(events.filter((event) => event.eventType === "tool_call").map((event) => event.toolName)).toEqual([
      "getPatientContext",
      "getRecentEncounters",
      "getCarePlan",
      "searchClinicalKnowledge",
      "createCareTask",
    ]);
    expect(events.filter((event) => event.eventType === "tool_result")).toHaveLength(5);
    expect(events.some((event) => event.eventType === "finish")).toBe(true);
    expect(events.some((event) => event.eventType === "safety_review")).toBe(true);

    const tasks = await repos.careTasks.listByPatientId(patient.id);
    expect(tasks).toHaveLength(0);

    const audits = await repos.auditEvents.listByAgentRunId(outcome.runId);
    expect(audits.some((event) => event.toolName === "createCareTask" && event.outcome === "denied")).toBe(
      true,
    );
    expect(audits.filter((event) => event.outcome === "executed")).toHaveLength(4);
  });

  it("records a denied out-of-scope tool call and still finishes with uncertainty", async () => {
    const { provider, patient, encounter } = await createFixture();
    const runner = createCareCoordinatorRunner({
      model: createScriptedModelProvider([
        {
          type: "tool_call",
          toolName: "getPatientContext",
          arguments: { patientId: "patient_fictional_marcus" },
        },
        {
          type: "tool_call",
          toolName: "getPatientContext",
          arguments: { patientId: patient.id },
        },
        { type: "finish", result: uncertainResult() },
      ]),
      gateway,
      runs: repos.agentRuns,
      events: repos.agentEvents,
    });

    const outcome = await runner.run({
      session: bindRunSession({
        actor: { id: provider.id, role: "care_coordinator" },
        patientId: patient.id,
        allowedPatientIds: [patient.id],
      }),
      agentRunId: testId("run"),
      encounter: {
        id: encounter.id,
        transcript: encounter.transcript,
        occurredAt: encounter.occurredAt,
      },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error(outcome.message);
    }
    expect(outcome.result.uncertainty.isUncertain).toBe(true);
    expect(outcome.result.identifiedConcerns).toEqual([]);

    const audits = await repos.auditEvents.listByAgentRunId(outcome.runId);
    expect(audits.some((event) => event.outcome === "denied" && event.code === "UNAUTHORIZED")).toBe(
      true,
    );
    expect(audits.some((event) => event.outcome === "executed")).toBe(true);
  });
});
