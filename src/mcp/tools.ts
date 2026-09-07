import { evalCategories, type EvalCategory } from "@/eval/types";
import { compareEvalFailures, failedScenarios } from "@/eval/compare";
import { runEvalSuite } from "@/eval/run";
import { readLatestResult, readPreviousResult } from "@/eval/store";
import { closeDb, getDb } from "@/lib/db/client";
import { createRepositories } from "@/lib/db/repositories";
import { createEvalKnowledgeIndex } from "@/eval/knowledge";
import { assembleTrace } from "@/trace/assemble";

export type McpJson = Record<string, unknown>;

let knowledgeIndex: ReturnType<typeof createEvalKnowledgeIndex> | undefined;

function knowledge() {
  knowledgeIndex ??= createEvalKnowledgeIndex();
  return knowledgeIndex;
}

export async function runEvaluation(input: { categories?: EvalCategory[] } = {}): Promise<McpJson> {
  const categories = input.categories?.length ? input.categories : undefined;
  const { result, jsonPath, previous } = await runEvalSuite({ categories });
  const delta = compareEvalFailures(result, previous);
  return {
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    gitSha: result.gitSha,
    agentVersion: result.agentVersion,
    model: result.model,
    jsonPath,
    metrics: {
      scenarioCount: result.metrics.scenarioCount,
      passedCount: result.metrics.passedCount,
      passRate: result.metrics.passRate,
    },
    failures: failedScenarios(result),
    comparedWithPrevious: delta,
  };
}

export function getEvaluationFailures(): McpJson {
  const latest = readLatestResult();
  if (!latest) {
    return {
      error: "no_eval_results",
      message: "No evaluation results yet. Call run_evaluation or run npm run eval.",
    };
  }
  const previous = readPreviousResult();
  return {
    startedAt: latest.startedAt,
    gitSha: latest.gitSha,
    agentVersion: latest.agentVersion,
    model: latest.model,
    metrics: {
      scenarioCount: latest.metrics.scenarioCount,
      passedCount: latest.metrics.passedCount,
      passRate: latest.metrics.passRate,
    },
    failures: failedScenarios(latest),
    comparedWithPrevious: compareEvalFailures(latest, previous),
  };
}

export async function getAgentTrace(input: { runId?: string } = {}): Promise<McpJson> {
  const repos = createRepositories(getDb());
  try {
    const run = input.runId
      ? await repos.agentRuns.getById(input.runId)
      : (await repos.agentRuns.listRecent(1))[0] ?? null;
    if (!run) {
      return {
        error: "run_not_found",
        message: input.runId
          ? `No agent run with id ${input.runId}.`
          : "No agent runs are stored. Seed the database or pass runId.",
      };
    }

    const [events, approvals, audits] = await Promise.all([
      repos.agentEvents.listByAgentRunId(run.id),
      repos.approvalRequests.listByAgentRunId(run.id),
      repos.auditEvents.listByAgentRunId(run.id),
    ]);
    const trace = assembleTrace({ run, events, approvals, audits });

    return omitPatientIds({
      runId: run.id,
      agentName: run.agentName,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      events: trace.events.map((event) => ({
        id: event.id,
        kind: event.kind,
        at: event.at.toISOString(),
        durationMs: event.durationMs,
        actor: event.actor,
        toolName: event.toolName,
        model: event.model,
        outcome: event.outcome,
        input: event.input,
        output: event.output,
      })),
    }) as McpJson;
  } finally {
    await closeDb();
  }
}

export async function searchKnowledgeBase(input: {
  query: string;
  limit?: number;
}): Promise<McpJson> {
  const hits = await knowledge().search.search({
    query: input.query,
    limit: input.limit ?? 5,
  });
  return {
    query: input.query,
    results: hits.map((hit) => ({
      documentId: hit.documentId,
      title: hit.title,
      citationId: hit.citationId,
      source: hit.source,
      version: hit.version,
      similarityScore: hit.similarityScore,
      relevantText: hit.relevantText,
    })),
  };
}

export function parseCategories(values: string[] | undefined): EvalCategory[] | undefined {
  if (!values?.length) {
    return undefined;
  }
  return values.map((value) => {
    if (!evalCategories.includes(value as EvalCategory)) {
      throw new Error(`unknown eval category: ${value}`);
    }
    return value as EvalCategory;
  });
}

function omitPatientIds(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(omitPatientIds);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "patientId")
        .map(([key, nested]) => [key, omitPatientIds(nested)]),
    );
  }
  return value;
}
