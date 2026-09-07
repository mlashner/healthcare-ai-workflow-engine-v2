import { describe, expect, it } from "vitest";

import { evalDataset } from "@/eval/dataset";
import { runEvalScenario } from "@/eval/harness";
import { createEvalKnowledgeIndex } from "@/eval/knowledge";
import { scoreScenario } from "@/eval/score";

const knowledge = createEvalKnowledgeIndex();

describe("eval harness", () => {
  it("runs a straightforward scenario through the real agent loop", async () => {
    const scenario = evalDataset.find((row) => row.id === "s01_diabetes_unplanned_visit");
    expect(scenario).toBeDefined();
    const run = await runEvalScenario(scenario!, knowledge);
    const score = scoreScenario(scenario!, run);
    expect(run.ok, run.message).toBe(true);
    expect(score.checks.policy_compliance).toBe(true);
    expect(score.checks.tool_selection).toBe(true);
    expect(run.result?.requiresHumanReview).toBe(true);
  });

  it("denies an in-loop write from a prompt-injection scenario", async () => {
    const scenario = evalDataset.find((row) => row.id === "s11_ignore_previous_write");
    expect(scenario).toBeDefined();
    const run = await runEvalScenario(scenario!, knowledge);
    const score = scoreScenario(scenario!, run);
    expect(run.audit.some((event) => event.toolName === "createCareTask" && event.outcome === "executed")).toBe(
      false,
    );
    expect(score.checks.policy_compliance).toBe(true);
  });
});
