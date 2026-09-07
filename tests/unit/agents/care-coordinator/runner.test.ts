import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createCareCoordinatorRunner } from "@/agents/care-coordinator";
import type { CareCoordinatorResult } from "@/agents/care-coordinator";
import type { ToolInvoker } from "@/agents/runner";
import { createInMemoryAuditWriter } from "@/audit/writer";
import { createGetPatientContextTool } from "@/tools/definitions";
import { createToolGateway } from "@/tools/gateway";
import { ToolRegistry } from "@/tools/registry";
import type { ToolInvocationResult } from "@/tools/types";
import {
  createFailingModelProvider,
  createScriptedModelProvider,
  ModelError,
} from "@/llm";
import { createInMemoryEventStore, createInMemoryRunStore } from "@/runs";

const patientId = "patient_in_scope";
const citationId = "cite:kb_diabetes_followup:0";

const encounter = {
  id: "encounter_in_scope",
  transcript:
    "FICTIONAL ENCOUNTER — not a real visit. Provider: follow up after last week's unplanned clinic visit.",
};

function uncertainResult(): CareCoordinatorResult {
  return {
    summary: "Fictional review only. No coordination issue can be confirmed.",
    identifiedConcerns: [],
    urgency: "none",
    reasoning: "Retrieved evidence is insufficient. This is not a diagnosis.",
    evidence: [],
    proposedActions: [],
    requiresHumanReview: true,
    confidence: 0.2,
    uncertainty: { isUncertain: true, reasons: ["Insufficient retrieved evidence."] },
  };
}

function citedResult(): CareCoordinatorResult {
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
    confidence: 0.7,
    uncertainty: { isUncertain: false, reasons: [] },
  };
}

function scriptedGateway(handler: (toolName: string, args: unknown) => ToolInvocationResult): ToolInvoker {
  return {
    async invoke(toolName, args) {
      return handler(toolName, args);
    },
  };
}

function createRunner(options: {
  script: unknown[];
  gateway?: ToolInvoker;
  budgets?: Parameters<typeof createCareCoordinatorRunner>[0]["budgets"];
}) {
  const runs = createInMemoryRunStore();
  const events = createInMemoryEventStore();
  const runner = createCareCoordinatorRunner({
    model: createScriptedModelProvider(options.script),
    gateway: options.gateway ?? scriptedGateway(() => ({
      ok: false,
      toolName: "unknown",
      error: { code: "UNKNOWN_TOOL", message: "not stubbed" },
    })),
    runs,
    events,
    budgets: options.budgets,
  });

  return { runner, runs, events };
}

async function runCoordinator(
  runner: ReturnType<typeof createCareCoordinatorRunner>,
) {
  return runner.run({
    actor: { id: "actor_1", role: "care_coordinator" },
    patientId,
    encounter,
  });
}

describe("care coordinator runner", () => {
  it("records model invocations, tool calls, tool results, and the final recommendation", async () => {
    const { runner, events, runs } = createRunner({
      script: [
        { type: "think", thought: "Need chart context and knowledge before finishing." },
        {
          type: "tool_call",
          toolName: "getPatientContext",
          arguments: { patientId },
        },
        {
          type: "tool_call",
          toolName: "searchClinicalKnowledge",
          arguments: { query: "diabetes follow-up after unplanned clinic visit" },
        },
        { type: "finish", result: citedResult() },
      ],
      gateway: scriptedGateway((toolName) => {
        if (toolName === "getPatientContext") {
          return {
            ok: true,
            toolName,
            output: {
              patientId,
              name: "In Scope (FICTIONAL)",
              dateOfBirth: "1978-06-21",
              conditions: [{ name: "Type 2 diabetes mellitus" }],
              medications: [],
            },
          };
        }
        return {
          ok: true,
          toolName,
          output: {
            query: "diabetes follow-up",
            results: [
              {
                documentId: "kb_diabetes_followup",
                title: "Fictional diabetes follow-up",
                relevantText: "Follow up after an unplanned visit.",
                similarityScore: 0.6,
                source: "knowledge_base",
                version: "1",
                citationId,
              },
            ],
          },
        };
      }),
    });

    const outcome = await runCoordinator(runner);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error(outcome.message);
    }
    expect(outcome.result.evidence.some((item) => item.kind === "retrieved")).toBe(true);
    expect(outcome.result.evidence.some((item) => item.kind === "inferred")).toBe(true);
    expect(outcome.result.identifiedConcerns[0]?.citationIds).toEqual([citationId]);
    expect(outcome.result.requiresHumanReview).toBe(true);
    expect(runs.runs[0]?.status).toBe("completed");

    const kinds = events.events.map((event) => event.eventType);
    expect(kinds.filter((kind) => kind === "think").length).toBeGreaterThanOrEqual(2);
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("tool_result");
    expect(kinds).toContain("finish");
    expect(
      events.events.some(
        (event) =>
          event.eventType === "think" &&
          event.input !== null &&
          typeof event.input === "object" &&
          "kind" in event.input &&
          event.input.kind === "model_invocation",
      ),
    ).toBe(true);
    expect(events.events.some((event) => event.eventType === "finish")).toBe(true);
  });

  it("treats tool failures as observations and continues the run", async () => {
    const calls: string[] = [];
    const { runner, events } = createRunner({
      script: [
        {
          type: "tool_call",
          toolName: "getPatientContext",
          arguments: { patientId: "patient_other" },
        },
        {
          type: "tool_call",
          toolName: "getPatientContext",
          arguments: { patientId },
        },
        { type: "finish", result: uncertainResult() },
      ],
      gateway: scriptedGateway((toolName, args) => {
        calls.push(JSON.stringify(args));
        const record = args as { patientId?: string };
        if (record.patientId !== patientId) {
          return {
            ok: false,
            toolName,
            error: { code: "UNAUTHORIZED", message: "patientId is outside the bound run scope" },
          };
        }
        return {
          ok: true,
          toolName,
          output: { patientId, name: "In Scope (FICTIONAL)", dateOfBirth: "1978-06-21", conditions: [], medications: [] },
        };
      }),
    });

    const outcome = await runCoordinator(runner);
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(
      events.events.some(
        (event) =>
          event.eventType === "tool_result" &&
          event.output !== null &&
          typeof event.output === "object" &&
          "ok" in event.output &&
          event.output.ok === false,
      ),
    ).toBe(true);
  });

  it("fails closed when the iteration budget is exhausted", async () => {
    const { runner, runs } = createRunner({
      script: [
        { type: "think", thought: "one" },
        { type: "think", thought: "two" },
        { type: "think", thought: "three" },
        { type: "finish", result: uncertainResult() },
      ],
      budgets: { maxIterations: 2 },
    });

    const outcome = await runCoordinator(runner);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("BUDGET_EXHAUSTED");
    }
    expect(runs.runs[0]?.status).toBe("failed");
    expect(outcome.events.some((event) => event.eventType === "finish")).toBe(false);
  });

  it("fails closed when the tool-call budget is exhausted", async () => {
    const { runner } = createRunner({
      script: [
        { type: "tool_call", toolName: "getPatientContext", arguments: { patientId } },
        { type: "tool_call", toolName: "getCarePlan", arguments: { patientId } },
        { type: "finish", result: uncertainResult() },
      ],
      budgets: { maxToolCalls: 1 },
      gateway: scriptedGateway((toolName) => ({
        ok: true,
        toolName,
        output: { patientId },
      })),
    });

    const outcome = await runCoordinator(runner);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("BUDGET_EXHAUSTED");
      expect(outcome.message).toMatch(/tool-call/i);
    }
  });

  it("retries invalid model output then fails closed", async () => {
    const { runner } = createRunner({
      script: [
        { not: "a step" },
        { still: "wrong" },
        { also: "wrong" },
      ],
      budgets: { maxSchemaRetries: 2, maxIterations: 6 },
    });

    const outcome = await runCoordinator(runner);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("SCHEMA_FAILURE");
    }
  });

  it("retries a finish that claims to diagnose, then accepts a valid uncertain result", async () => {
    const { runner } = createRunner({
      script: [
        {
          type: "finish",
          result: {
            ...uncertainResult(),
            summary: "I diagnose type 2 diabetes from this encounter.",
          },
        },
        { type: "finish", result: uncertainResult() },
      ],
    });

    const outcome = await runCoordinator(runner);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.summary).not.toMatch(/I diagnose/i);
      expect(outcome.result.uncertainty.isUncertain).toBe(true);
    }
  });

  it("fails the provider after the retry cap and does not invent a recommendation", async () => {
    const runs = createInMemoryRunStore();
    const events = createInMemoryEventStore();
    const runner = createCareCoordinatorRunner({
      model: createFailingModelProvider(new ModelError("TIMEOUT", "provider timed out")),
      gateway: scriptedGateway(() => ({
        ok: false,
        toolName: "none",
        error: { code: "UNKNOWN_TOOL", message: "unused" },
      })),
      runs,
      events,
      budgets: { maxProviderRetries: 1, maxIterations: 4 },
    });

    const outcome = await runCoordinator(runner);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("PROVIDER_FAILURE");
    }
    expect(outcome.events.some((event) => event.eventType === "finish")).toBe(false);
  });

  it("sends unauthorized tool proposals to the gateway instead of authorizing them", async () => {
    const audit = createInMemoryAuditWriter();
    const getById = async () => ({
      id: patientId,
      name: "In Scope (FICTIONAL)",
      dateOfBirth: "1978-06-21",
      conditions: [],
      medications: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const gateway = createToolGateway({
      registry: new ToolRegistry().register(createGetPatientContextTool({ getById })),
      audit,
    });
    const { runner } = createRunner({
      script: [
        {
          type: "tool_call",
          toolName: "getPatientContext",
          arguments: { patientId: "patient_other" },
        },
        { type: "finish", result: uncertainResult() },
      ],
      gateway,
    });

    const outcome = await runCoordinator(runner);
    expect(outcome.ok).toBe(true);
    expect(audit.events[0]).toMatchObject({
      outcome: "denied",
      code: "UNAUTHORIZED",
      patientScope: patientId,
    });
  });

  it("does not import a database client from the agent or model packages", () => {
    const files = [
      "src/agents/runner.ts",
      "src/agents/care-coordinator/runner.ts",
      "src/agents/care-coordinator/prompt.ts",
      "src/agents/care-coordinator/result.ts",
      "src/agents/care-coordinator/schemas.ts",
      "src/llm/decode.ts",
      "src/llm/scripted.ts",
      "src/llm/types.ts",
    ];

    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/@\/lib\/db/);
      expect(source, file).not.toMatch(/drizzle-orm/);
      expect(source, file).not.toMatch(/authorizeToolCall/);
    }
  });
});
