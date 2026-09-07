import { randomBytes } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";

import { createCareCoordinatorRunner } from "@/agents/care-coordinator";
import type { CareCoordinatorResult } from "@/agents/care-coordinator";
import { createRepositoryAuditWriter } from "@/audit/writer";
import { resolveClinician } from "@/authz/patient-access";
import { closeDb, getDb } from "@/lib/db/client";
import { createRepositories } from "@/lib/db/repositories";
import { agentRuns, careTasks, encounters, patients, providers } from "@/lib/db/schema";
import { seedFictionalData, seedIds } from "@/lib/db/seed";
import { seedReviewFixture } from "@/lib/db/seed-review";
import { createScriptedModelProvider } from "@/llm";
import type { ModelMessage } from "@/llm";
import { bindRunSession } from "@/runs";
import { formatCitationId } from "@/retrieval/citations";
import { createReviewDecisionService } from "@/review/decisions";
import { assembleTrace, loadAgentTrace } from "@/trace/assemble";
import { createToolRegistry } from "@/tools/catalog";
import { createToolGateway } from "@/tools/gateway";

const db = getDb();
const repos = createRepositories(db);
const audit = createRepositoryAuditWriter(repos.auditEvents);
const registry = createToolRegistry(repos);
const gateway = createToolGateway({ registry, audit });

beforeAll(async () => {
  await seedFictionalData(db);
});

afterEach(async () => {
  await db.delete(agentRuns).where(like(agentRuns.patientId, "test_trace_%"));
  await db.delete(careTasks).where(like(careTasks.patientId, "test_trace_%"));
  await db.delete(encounters).where(like(encounters.patientId, "test_trace_%"));
  await db.delete(patients).where(like(patients.id, "test_trace_%"));
  await db.delete(providers).where(like(providers.id, "test_trace_%"));
});

afterAll(async () => {
  await closeDb();
});

function testId(label: string): string {
  return `test_trace_${label}_${crypto.randomUUID().slice(0, 8)}`;
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

describe("agent trace from a complete run", () => {
  it("records the in-loop trail a clinician should see, with demographics redacted", async () => {
    const provider = await repos.providers.create({
      id: testId("provider"),
      name: "Trace Test Provider (FICTIONAL)",
      role: "care_coordinator",
    });
    const patient = await repos.patients.create({
      id: testId("patient"),
      name: "Trace Test Patient (FICTIONAL)",
      dateOfBirth: "1978-06-21",
      conditions: [{ name: "Type 2 diabetes mellitus" }],
      medications: [{ name: "metformin", dosage: "500 mg", frequency: "twice daily" }],
    });
    const encounter = await repos.encounters.create({
      id: testId("encounter"),
      patientId: patient.id,
      providerId: provider.id,
      occurredAt: new Date("2026-08-28T15:10:00.000Z"),
      transcript: "FICTIONAL ENCOUNTER — not a real patient visit.",
    });

    const fallbackCitation = formatCitationId("kb_diabetes_followup", 1);
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
          const match = /cite:[A-Za-z0-9_-]+:\d+/.exec(JSON.stringify(messages));
          return { type: "finish", result: citedResult(match?.[0] ?? fallbackCitation) };
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

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error(outcome.message);
    }

    const [events, approvals, audits] = await Promise.all([
      repos.agentEvents.listByAgentRunId(outcome.runId),
      repos.approvalRequests.listByAgentRunId(outcome.runId),
      repos.auditEvents.listByAgentRunId(outcome.runId),
    ]);
    const run = await repos.agentRuns.getById(outcome.runId);
    const trace = assembleTrace({ run: run!, events, approvals, audits });
    const kinds = trace.events.map((item) => item.kind);

    expect(kinds[0]).toBe("agent_started");
    expect(kinds).toContain("model_reasoning");
    expect(kinds.filter((kind) => kind === "context_requested").length).toBeGreaterThanOrEqual(3);
    expect(kinds).toContain("knowledge_retrieved");
    expect(kinds).toContain("tool_called");
    expect(kinds).toContain("tool_result");
    expect(kinds).toContain("recommendation_generated");
    expect(kinds).toContain("safety_review");

    const times = trace.events.map((item) => item.at.getTime());
    expect(times).toEqual([...times].sort((left, right) => left - right));

    const encoded = JSON.stringify(trace.events);
    expect(encoded).not.toMatch(/sk-|password|authorization/i);
    expect(encoded).not.toContain("Trace Test Patient (FICTIONAL)");
    expect(encoded).not.toContain("FICTIONAL ENCOUNTER");

    const writeResult = trace.events.find(
      (item) => item.kind === "tool_result" && item.toolName === "createCareTask",
    );
    expect(writeResult?.outcome).toBe("failure");
    expect(trace.events.some((item) => item.kind === "action_executed")).toBe(false);
  });

  it("appends policy, human decision, and execution after an approval", async () => {
    const seeded = await seedReviewFixture(db, {
      runId: `run_tr_${randomBytes(4).toString("hex")}`,
      patientId: seedIds.patients.ava,
    });
    const clinician = (await resolveClinician(
      { providers: repos.providers, encounters: repos.encounters, careTasks: repos.careTasks },
      seedIds.providers.blake,
    ))!;
    const action = seeded.pendingActions.find((item) => item.toolName === "createCareTask")!;
    const decisions = createReviewDecisionService({ repos, registry, gateway, audit });

    const decided = await decisions.decide({
      runId: seeded.runId,
      pendingActionId: action.id,
      clinician,
      request: { decision: "approve", expectedContentHash: action.contentHash },
    });
    expect(decided.ok).toBe(true);

    const trace = await loadAgentTrace(repos, seeded.runId, {
      actor: clinician.actor,
      authorizedPatientIds: clinician.authorizedPatientIds,
    });

    const kinds = new Set(trace!.events.map((item) => item.kind));
    expect(kinds.has("agent_started")).toBe(true);
    expect(kinds.has("model_reasoning")).toBe(true);
    expect(kinds.has("context_requested")).toBe(true);
    expect(kinds.has("knowledge_retrieved")).toBe(true);
    expect(kinds.has("recommendation_generated")).toBe(true);
    expect(kinds.has("safety_review")).toBe(true);
    expect(kinds.has("approval_requested")).toBe(true);
    expect(kinds.has("policy_evaluation")).toBe(true);
    expect(kinds.has("human_decision")).toBe(true);
    expect(kinds.has("action_executed")).toBe(true);
  });

  it("hides traces outside the viewer's patient scope", async () => {
    const seeded = await seedReviewFixture(db, {
      runId: `run_tr_${randomBytes(4).toString("hex")}`,
      patientId: seedIds.patients.ava,
    });
    const hidden = await loadAgentTrace(repos, seeded.runId, {
      actor: { id: seedIds.providers.patel, role: "reviewer" },
      authorizedPatientIds: [],
    });
    expect(hidden).toBeNull();
  });
});
