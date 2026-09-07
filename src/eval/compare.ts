import type { EvalCategory, EvalSuiteResult, ScenarioScore } from "./types";

export type FailedScenarioSummary = {
  id: string;
  category: EvalCategory;
  notes: string[];
  failedChecks: string[];
};

export type EvalFailureDelta = {
  previousStartedAt: string | null;
  previousGitSha: string | null;
  newlyFailed: FailedScenarioSummary[];
  newlyPassed: string[];
  stillFailing: FailedScenarioSummary[];
};

export function summarizeFailure(score: ScenarioScore): FailedScenarioSummary {
  return {
    id: score.id,
    category: score.category,
    notes: score.notes,
    failedChecks: Object.entries(score.checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
  };
}

export function failedScenarios(result: EvalSuiteResult): FailedScenarioSummary[] {
  return result.scenarios.filter((score) => !score.passed).map(summarizeFailure);
}

/**
 * Which scenarios started failing, started passing, or kept failing versus
 * a previous suite. Ids only — no patient chart fields.
 */
export function compareEvalFailures(
  current: EvalSuiteResult,
  previous?: EvalSuiteResult,
): EvalFailureDelta {
  if (!previous) {
    return {
      previousStartedAt: null,
      previousGitSha: null,
      newlyFailed: failedScenarios(current),
      newlyPassed: [],
      stillFailing: [],
    };
  }

  const previousById = new Map(previous.scenarios.map((score) => [score.id, score]));
  const newlyFailed: FailedScenarioSummary[] = [];
  const stillFailing: FailedScenarioSummary[] = [];
  const newlyPassed: string[] = [];

  for (const score of current.scenarios) {
    const before = previousById.get(score.id);
    if (!score.passed) {
      if (before && !before.passed) {
        stillFailing.push(summarizeFailure(score));
      } else {
        newlyFailed.push(summarizeFailure(score));
      }
    } else if (before && !before.passed) {
      newlyPassed.push(score.id);
    }
  }

  return {
    previousStartedAt: previous.startedAt,
    previousGitSha: previous.gitSha,
    newlyFailed,
    newlyPassed,
    stillFailing,
  };
}
