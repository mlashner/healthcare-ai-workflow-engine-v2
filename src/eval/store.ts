import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { formatEvalReport } from "./report";
import type { EvalSuiteResult } from "./types";
import { repoRoot } from "./version";

export const EVAL_RESULTS_DIR = "eval/results";
export const EVAL_LATEST_JSON = "latest.json";
export const EVAL_LATEST_MD = "latest.md";

export function resultsDirectory(): string {
  return join(repoRoot(), EVAL_RESULTS_DIR);
}

export function writeEvalResult(result: EvalSuiteResult): {
  jsonPath: string;
  latestJsonPath: string;
  latestMarkdownPath: string;
  previous?: EvalSuiteResult;
} {
  const directory = resultsDirectory();
  mkdirSync(directory, { recursive: true });
  const previous = readLatestResult();
  const stamp = result.startedAt.replace(/[:.]/g, "-");
  const jsonPath = join(directory, `${stamp}-${result.gitSha}.json`);
  const latestJsonPath = join(directory, EVAL_LATEST_JSON);
  const latestMarkdownPath = join(directory, EVAL_LATEST_MD);
  const payload = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(jsonPath, payload);
  writeFileSync(latestJsonPath, payload);
  writeFileSync(latestMarkdownPath, formatEvalReport(result, previous));
  return { jsonPath, latestJsonPath, latestMarkdownPath, previous };
}

export function readLatestResult(directory = resultsDirectory()): EvalSuiteResult | undefined {
  try {
    return JSON.parse(readFileSync(join(directory, EVAL_LATEST_JSON), "utf8")) as EvalSuiteResult;
  } catch {
    return undefined;
  }
}

export function listEvalSuiteResults(directory = resultsDirectory()): EvalSuiteResult[] {
  let names: string[] = [];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }

  const results: EvalSuiteResult[] = [];
  for (const name of names) {
    if (name === EVAL_LATEST_JSON || !name.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(join(directory, name), "utf8")) as EvalSuiteResult;
      if (typeof parsed.startedAt === "string" && Array.isArray(parsed.scenarios)) {
        results.push(parsed);
      }
    } catch {
      continue;
    }
  }

  return results.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

/** Most recent timestamped suite that is not the current `latest.json`. */
export function readPreviousResult(directory = resultsDirectory()): EvalSuiteResult | undefined {
  const latest = readLatestResult(directory);
  const listed = listEvalSuiteResults(directory);
  return [...listed].reverse().find((result) => result.startedAt !== latest?.startedAt);
}
