import { createCareCoordinatorRunner } from "@/agents/care-coordinator";
import { createInMemoryAuditWriter } from "@/audit/writer";
import type { ApprovalRequest, CareTask, Encounter, Patient } from "@/lib/domain";
import { bindRunSession, createInMemoryEventStore, createInMemoryRunStore } from "@/runs";
import {
  createCreateCareTaskTool,
  createDraftPatientMessageTool,
  createGetCarePlanTool,
  createGetPatientContextTool,
  createGetRecentEncountersTool,
  createRequestHumanApprovalTool,
  createSearchClinicalKnowledgeTool,
} from "@/tools/definitions";
import { createToolGateway, type ToolGateway } from "@/tools/gateway";
import { ToolRegistry } from "@/tools/registry";
import type { SearchClinicalKnowledgeOutput } from "@/tools/schemas";
import type { ToolInvocationResult } from "@/tools/types";

import { outsiderPatient } from "./fixtures";
import type { EvalKnowledgeIndex } from "./knowledge";
import { buildScenarioScript, createEvalModelProvider } from "./script";
import type { EvalRunOutcome, EvalScenario } from "./types";

export async function runEvalScenario(
  scenario: EvalScenario,
  knowledge: EvalKnowledgeIndex,
): Promise<EvalRunOutcome> {
  const started = Date.now();
  const patients = new Map<string, Patient>();
  patients.set(scenario.patient.id, toPatient(scenario.patient));
  const outsider = scenario.outsiderPatient ?? outsiderPatient;
  patients.set(outsider.id, toPatient(outsider));

  const encounters: Encounter[] = [
    {
      id: scenario.encounter.id,
      patientId: scenario.patient.id,
      providerId: "prov_eval",
      transcript: scenario.encounter.transcript,
      occurredAt: new Date("2026-09-01T15:00:00.000Z"),
    },
  ];

  const careTasks: CareTask[] = [];
  const approvals: ApprovalRequest[] = [];
  const capturedSnippets: EvalRunOutcome["retrievedSnippets"] = [];
  const audit = createInMemoryAuditWriter();
  const runs = createInMemoryRunStore();
  const events = createInMemoryEventStore();

  const inner = createToolGateway({
    audit,
    registry: new ToolRegistry()
      .register(
        createGetPatientContextTool({
          getById: async (id) => patients.get(id) ?? null,
        }),
      )
      .register(
        createGetRecentEncountersTool({
          listByPatientId: async (patientId) =>
            encounters.filter((encounter) => encounter.patientId === patientId),
        }),
      )
      .register(
        createGetCarePlanTool({
          create: async (input) => {
            const created: CareTask = {
              id: `task_${careTasks.length + 1}`,
              patientId: input.patientId,
              type: input.type,
              description: input.description,
              priority: input.priority ?? "medium",
              status: input.status ?? "draft",
              assignedTo: input.assignedTo ?? null,
              createdAt: new Date(),
            };
            careTasks.push(created);
            return created;
          },
          listByPatientId: async (patientId) =>
            careTasks.filter((task) => task.patientId === patientId),
        }),
      )
      .register(createSearchClinicalKnowledgeTool(knowledge.search))
      .register(
        createCreateCareTaskTool({
          create: async (input) => {
            const created: CareTask = {
              id: `task_${careTasks.length + 1}`,
              patientId: input.patientId,
              type: input.type,
              description: input.description,
              priority: input.priority ?? "medium",
              status: input.status ?? "draft",
              assignedTo: input.assignedTo ?? null,
              createdAt: new Date(),
            };
            careTasks.push(created);
            return created;
          },
          listByPatientId: async (patientId) =>
            careTasks.filter((task) => task.patientId === patientId),
        }),
      )
      .register(
        createDraftPatientMessageTool({
          create: async (input) => {
            const created: CareTask = {
              id: `task_${careTasks.length + 1}`,
              patientId: input.patientId,
              type: input.type,
              description: input.description,
              priority: input.priority ?? "medium",
              status: input.status ?? "draft",
              assignedTo: input.assignedTo ?? null,
              createdAt: new Date(),
            };
            careTasks.push(created);
            return created;
          },
          listByPatientId: async (patientId) =>
            careTasks.filter((task) => task.patientId === patientId),
        }),
      )
      .register(
        createRequestHumanApprovalTool({
          create: async (input) => {
            const created: ApprovalRequest = {
              id: `apr_${approvals.length + 1}`,
              agentRunId: input.agentRunId,
              action: {
                type: input.action.type,
                payload: input.action.payload ?? {},
              },
              status: input.status ?? "pending",
              requestedAt: new Date(),
              reviewedAt: null,
              reviewer: null,
              reason: input.reason ?? null,
            };
            approvals.push(created);
            return created;
          },
        }),
      ),
  });

  const gateway = wrapEvalGateway(inner, scenario, knowledge, capturedSnippets);
  const runner = createCareCoordinatorRunner({
    model: createEvalModelProvider(buildScenarioScript(scenario)),
    gateway,
    runs,
    events,
  });

  const outcome = await runner.run({
    session: bindRunSession({
      actor: { id: "actor_eval", role: "care_coordinator" },
      patientId: scenario.patient.id,
      allowedPatientIds: [scenario.patient.id],
    }),
    encounter: {
      id: scenario.encounter.id,
      transcript: scenario.encounter.transcript,
    },
  });

  return {
    ok: outcome.ok,
    status: outcome.status,
    runId: outcome.runId,
    code: outcome.ok ? undefined : outcome.code,
    message: outcome.ok ? undefined : outcome.message,
    result: outcome.ok ? outcome.result : undefined,
    events: outcome.events,
    audit: audit.events.map((event) => ({
      toolName: event.toolName,
      outcome: event.outcome,
      code: event.code,
    })),
    retrievedDocumentIds: [...new Set(capturedSnippets.map((snippet) => snippet.documentId))],
    retrievedCitationIds: capturedSnippets.map((snippet) => snippet.citationId),
    retrievedSnippets: capturedSnippets,
    latencyMs: Date.now() - started,
  };
}

function wrapEvalGateway(
  inner: ToolGateway,
  scenario: EvalScenario,
  knowledge: EvalKnowledgeIndex,
  capturedSnippets: EvalRunOutcome["retrievedSnippets"],
): ToolGateway {
  const failing = new Set<string>(scenario.expectedToolBehavior.failingTools ?? []);
  const injectIds = scenario.expectedToolBehavior.injectDocumentIds ?? [];

  return {
    async invoke(toolName, rawArgs, context): Promise<ToolInvocationResult> {
      if (failing.has(toolName)) {
        return {
          ok: false,
          toolName,
          error: { code: "EXECUTION_ERROR", message: "simulated tool failure" },
        };
      }

      const result = await inner.invoke(toolName, rawArgs, context);
      if (!result.ok || toolName !== "searchClinicalKnowledge") {
        return result;
      }

      const output = result.output as SearchClinicalKnowledgeOutput;
      const injected = injectIds
        .map((documentId) => knowledge.hitForDocument(documentId))
        .filter((hit): hit is NonNullable<typeof hit> => hit !== undefined);
      const merged =
        injected.length > 0
          ? [...injected, ...output.results.filter((hit) => !injectIds.includes(hit.documentId))].slice(
              0,
              5,
            )
          : output.results;

      for (const hit of merged) {
        capturedSnippets.push({
          citationId: hit.citationId,
          text: hit.relevantText,
          documentId: hit.documentId,
        });
      }

      return {
        ok: true,
        toolName,
        output: { ...output, results: merged },
      };
    },
  };
}

function toPatient(input: {
  id: string;
  name: string;
  dateOfBirth: string;
  conditions: Array<{ name: string; notes?: string }>;
  medications: Array<{ name: string; dosage?: string; frequency?: string }>;
}): Patient {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: input.id,
    name: input.name,
    dateOfBirth: input.dateOfBirth,
    conditions: input.conditions,
    medications: input.medications,
    createdAt: now,
    updatedAt: now,
  };
}

