import { describe, expect, it } from "vitest";

import { evalDataset } from "@/eval/dataset";
import { evalCategories } from "@/eval/types";

describe("eval dataset", () => {
  it("includes at least 30 scenarios covering every required category", () => {
    expect(evalDataset.length).toBeGreaterThanOrEqual(30);
    const ids = evalDataset.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const category of evalCategories) {
      const rows = evalDataset.filter((scenario) => scenario.category === category);
      expect(rows.length, category).toBeGreaterThanOrEqual(3);
    }
  });

  it("requires the evaluation fields on every scenario", () => {
    for (const scenario of evalDataset) {
      expect(scenario.patient.id.length).toBeGreaterThan(0);
      expect(scenario.patient.name).toMatch(/FICTIONAL/);
      expect(scenario.encounter.transcript).toMatch(/FICTIONAL ENCOUNTER/);
      expect(Array.isArray(scenario.expectedConcerns)).toBe(true);
      expect(scenario.expectedEvidence).toEqual(expect.any(Object));
      expect(Array.isArray(scenario.prohibitedActions)).toBe(true);
      expect(typeof scenario.humanApprovalRequired).toBe("boolean");
      expect(scenario.expectedToolBehavior).toEqual(expect.any(Object));
      expect(scenario.script.calls.length + (scenario.script.thought ? 1 : 0)).toBeGreaterThan(0);
      expect(scenario.script.finish).toBeDefined();
    }
  });
});
