import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EVAL_RESULTS_DIR = "eval/results";
const EVAL_LATEST_JSON = "latest.json";

export type EvalScorePoint = {
  startedAt: string;
  finishedAt: string;
  passRate: number;
  passedCount: number;
  scenarioCount: number;
  policyCompliance: number;
  citationCorrectness: number;
  humanEscalationCorrectness: number;
  gitSha: string;
  model: string;
  agentVersion: string;
};

/**
 * Reads timestamped eval suite files. `latest.json` is a duplicate pointer and
 * is skipped so the trend line is not doubled. Missing directories yield [].
 */
export function listEvalScoreHistory(directory = join(process.cwd(), EVAL_RESULTS_DIR)): EvalScorePoint[] {
  let names: string[] = [];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }

  const points: EvalScorePoint[] = [];
  for (const name of names) {
    if (name === EVAL_LATEST_JSON || !name.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(join(directory, name), "utf8")) as unknown;
      const point = toScorePoint(parsed);
      if (point) {
        points.push(point);
      }
    } catch {
      continue;
    }
  }

  return points.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

export function toScorePoint(value: unknown): EvalScorePoint | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as {
    startedAt?: unknown;
    finishedAt?: unknown;
    gitSha?: unknown;
    model?: unknown;
    agentVersion?: unknown;
    metrics?: {
      passRate?: unknown;
      passedCount?: unknown;
      scenarioCount?: unknown;
      policyCompliance?: unknown;
      citationCorrectness?: unknown;
      humanEscalationCorrectness?: unknown;
    };
    scenarioCount?: unknown;
  };
  if (typeof record.startedAt !== "string" || typeof record.metrics?.passRate !== "number") {
    return null;
  }
  const scenarioCount =
    typeof record.metrics.scenarioCount === "number"
      ? record.metrics.scenarioCount
      : typeof record.scenarioCount === "number"
        ? record.scenarioCount
        : 0;
  const passedCount =
    typeof record.metrics.passedCount === "number"
      ? record.metrics.passedCount
      : Math.round(record.metrics.passRate * scenarioCount);

  return {
    startedAt: record.startedAt,
    finishedAt: typeof record.finishedAt === "string" ? record.finishedAt : record.startedAt,
    passRate: record.metrics.passRate,
    passedCount,
    scenarioCount,
    policyCompliance: numericMetric(record.metrics.policyCompliance),
    citationCorrectness: numericMetric(record.metrics.citationCorrectness),
    humanEscalationCorrectness: numericMetric(record.metrics.humanEscalationCorrectness),
    gitSha: typeof record.gitSha === "string" ? record.gitSha : "unknown",
    model: typeof record.model === "string" ? record.model : "unknown",
    agentVersion: typeof record.agentVersion === "string" ? record.agentVersion : "unknown",
  };
}

function numericMetric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
