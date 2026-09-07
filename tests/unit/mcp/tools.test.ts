import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { listEvalSuiteResults, readPreviousResult } from "@/eval/store";
import { searchKnowledgeBase } from "@/mcp/tools";

describe("searchKnowledgeBase", () => {
  it("returns fictional knowledge hits with citation ids and no patient fields", async () => {
    const result = await searchKnowledgeBase({ query: "diabetes follow-up after unplanned visit", limit: 3 });
    const payload = JSON.stringify(result);
    expect(result.query).toBe("diabetes follow-up after unplanned visit");
    expect(Array.isArray(result.results)).toBe(true);
    expect((result.results as unknown[]).length).toBeGreaterThan(0);
    expect(payload).toContain("citationId");
    expect(payload).not.toContain("dateOfBirth");
    expect(payload).not.toContain("patientId");
  });
});

describe("listEvalSuiteResults", () => {
  it("skips latest.json so previous is the prior timestamped suite", () => {
    const directory = join(tmpdir(), `carepilot-mcp-eval-${Date.now()}`);
    mkdirSync(directory, { recursive: true });
    const older = {
      startedAt: "2026-09-06T01:00:00.000Z",
      scenarios: [{ id: "s_old", passed: false }],
    };
    const newer = {
      startedAt: "2026-09-07T01:00:00.000Z",
      scenarios: [{ id: "s_new", passed: false }],
    };
    writeFileSync(join(directory, "older.json"), JSON.stringify(older));
    writeFileSync(join(directory, "newer.json"), JSON.stringify(newer));
    writeFileSync(join(directory, "latest.json"), JSON.stringify(newer));

    const listed = listEvalSuiteResults(directory);
    expect(listed.map((item) => item.startedAt)).toEqual([
      "2026-09-06T01:00:00.000Z",
      "2026-09-07T01:00:00.000Z",
    ]);
    expect(readPreviousResult(directory)?.startedAt).toBe("2026-09-06T01:00:00.000Z");
  });
});
