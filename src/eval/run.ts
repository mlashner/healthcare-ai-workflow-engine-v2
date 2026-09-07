import { evalDataset } from "./dataset";
import { runEvalScenario } from "./harness";
import { createEvalKnowledgeIndex } from "./knowledge";
import { formatEvalReport } from "./report";
import { aggregateScores, scoreScenario } from "./score";
import { writeEvalResult } from "./store";
import type { EvalCategory, EvalSuiteResult } from "./types";
import { readAgentVersion, readGitSha } from "./version";

export async function runEvalSuite(options: { categories?: EvalCategory[] } = {}): Promise<{
  result: EvalSuiteResult;
  report: string;
  jsonPath: string;
}> {
  const startedAt = new Date().toISOString();
  const knowledge = createEvalKnowledgeIndex();
  const scenarios = options.categories
    ? evalDataset.filter((scenario) => options.categories?.includes(scenario.category))
    : evalDataset;

  const scores = [];
  for (const scenario of scenarios) {
    const run = await runEvalScenario(scenario, knowledge);
    scores.push(scoreScenario(scenario, run));
  }

  const finishedAt = new Date().toISOString();
  const aggregated = aggregateScores(scores);
  const result: EvalSuiteResult = {
    startedAt,
    finishedAt,
    agentVersion: readAgentVersion(),
    gitSha: readGitSha(),
    model: "scripted-baseline",
    ...aggregated,
    scenarios: scores,
  };

  const written = writeEvalResult(result);
  const report = formatEvalReport(result, written.previous);
  return { result, report, jsonPath: written.jsonPath };
}
