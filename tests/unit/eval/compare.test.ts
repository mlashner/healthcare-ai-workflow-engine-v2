import { describe, expect, it } from "vitest";

import { compareEvalFailures, failedScenarios } from "@/eval/compare";
import type { EvalSuiteResult, ScenarioScore } from "@/eval/types";
import { evalCategories } from "@/eval/types";

function suite(overrides: Partial<EvalSuiteResult> & { scenarios: ScenarioScore[] }): EvalSuiteResult {
  const passedCount = overrides.scenarios.filter((score) => score.passed).length;
  return {
    startedAt: "2026-09-07T00:00:00.000Z",
    finishedAt: "2026-09-07T00:00:01.000Z",
    agentVersion: "0.1.0",
    gitSha: "abc",
    model: "scripted-baseline",
    scenarioCount: overrides.scenarios.length,
    metrics: {
      scenarioCount: overrides.scenarios.length,
      passedCount,
      passRate: passedCount / overrides.scenarios.length,
      policyCompliance: 1,
      toolSelectionAccuracy: 1,
      evidenceRetrievalQuality: 1,
      citationCorrectness: 1,
      humanEscalationCorrectness: 1,
      prohibitedActionRate: 0,
      unsupportedClaimRate: 0,
      averageToolCalls: 1,
      averageLatencyMs: 10,
      estimatedModelCostUsd: 0,
    },
    byCategory: Object.fromEntries(
      evalCategories.map((category) => [category, { count: 0, passed: 0, passRate: 0 }]),
    ) as EvalSuiteResult["byCategory"],
    ...overrides,
  };
}

function score(id: string, passed: boolean): ScenarioScore {
  return {
    id,
    category: "straightforward",
    passed,
    checks: {
      policy_compliance: passed,
      tool_selection: true,
      evidence_retrieval: true,
      citation_correctness: true,
      human_escalation: true,
      prohibited_action_absent: true,
      unsupported_claim_absent: true,
      concerns_matched: true,
    },
    evidenceRetrievalQuality: 1,
    toolCallCount: 1,
    latencyMs: 10,
    estimatedCostUsd: 0,
    inputTokens: 1,
    outputTokens: 1,
    prohibitedActionOccurred: false,
    unsupportedClaimOccurred: false,
    notes: passed ? [] : ["policy failed"],
  };
}

describe("compareEvalFailures", () => {
  it("reports newly failed, newly passed, and still failing ids without chart fields", () => {
    const previous = suite({
      startedAt: "2026-09-06T00:00:00.000Z",
      gitSha: "old",
      scenarios: [score("s_ok", true), score("s_was_fail", false), score("s_keep_fail", false)],
    });
    const current = suite({
      scenarios: [score("s_ok", false), score("s_was_fail", true), score("s_keep_fail", false)],
    });

    const delta = compareEvalFailures(current, previous);
    expect(delta.previousGitSha).toBe("old");
    expect(delta.newlyFailed.map((item) => item.id)).toEqual(["s_ok"]);
    expect(delta.newlyPassed).toEqual(["s_was_fail"]);
    expect(delta.stillFailing.map((item) => item.id)).toEqual(["s_keep_fail"]);
    expect(JSON.stringify(delta)).not.toContain("patient");
    expect(JSON.stringify(delta)).not.toContain("dateOfBirth");
  });

  it("treats every current failure as new when there is no previous suite", () => {
    const current = suite({ scenarios: [score("s_a", false), score("s_b", true)] });
    const delta = compareEvalFailures(current);
    expect(delta.previousStartedAt).toBeNull();
    expect(failedScenarios(current).map((item) => item.id)).toEqual(["s_a"]);
    expect(delta.newlyFailed.map((item) => item.id)).toEqual(["s_a"]);
    expect(delta.stillFailing).toEqual([]);
  });
});
