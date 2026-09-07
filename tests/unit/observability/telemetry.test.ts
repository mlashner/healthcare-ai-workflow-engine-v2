import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AgentEvent, AgentRun } from "@/lib/domain";
import {
  aggregateTelemetry,
  buildRunTelemetry,
  listEvalScoreHistory,
  percentile,
  telemetryContainsForbiddenKeys,
  telemetryFromRun,
  toScorePoint,
} from "@/observability";

const metadata = {
  id: "scripted",
  displayName: "Scripted",
  model: "scripted",
  version: "scripted-v1",
  supportsStructuredOutput: true,
  supportsToolCalling: true,
  supportsStreaming: true,
};

function event(overrides: Partial<AgentEvent> & Pick<AgentEvent, "id" | "eventType">): AgentEvent {
  return {
    agentRunId: "run_obs",
    toolName: null,
    input: null,
    output: null,
    timestamp: new Date("2026-09-06T12:00:00.000Z"),
    ...overrides,
  };
}

describe("buildRunTelemetry", () => {
  it("records counters without copying chart fields from tool events", () => {
    const snapshot = buildRunTelemetry({
      runId: "run_obs",
      agentName: "care_coordinator",
      status: "completed",
      metadata,
      startedAt: new Date("2026-09-06T12:00:00.000Z"),
      completedAt: new Date("2026-09-06T12:00:04.000Z"),
      events: [
        event({
          id: "e1",
          eventType: "think",
          input: {
            kind: "model_invocation",
            iteration: 1,
            model: "scripted",
            modelVersion: "scripted-v1",
            inputTokens: 100,
            outputTokens: 20,
            estimatedCostUsd: 0.0006,
            latencyMs: 15,
          },
          output: { type: "tool_call", thought: "look up Ava Nguyen (FICTIONAL)" },
        }),
        event({
          id: "e2",
          eventType: "tool_call",
          toolName: "getPatientContext",
          input: {
            patientId: "patient_fictional_ava",
            name: "Ava Nguyen (FICTIONAL)",
            dateOfBirth: "1978-06-21",
            transcript: "secret visit",
          },
        }),
        event({
          id: "e3",
          eventType: "tool_result",
          toolName: "getPatientContext",
          output: {
            ok: false,
            error: { code: "UNAUTHORIZED", message: "out of scope" },
          },
        }),
        event({
          id: "e4",
          eventType: "error",
          input: {
            kind: "model_invocation",
            iteration: 1,
            model: "scripted",
            modelVersion: "scripted-v1",
            failed: true,
            latencyMs: 8,
          },
          output: { code: "PROVIDER_FAILURE", message: "timeout" },
        }),
      ],
    });

    expect(snapshot).toMatchObject({
      kind: "run_telemetry",
      runId: "run_obs",
      agentName: "care_coordinator",
      model: "scripted",
      modelVersion: "scripted-v1",
      inputTokens: 100,
      outputTokens: 20,
      estimatedCostUsd: 0.0006,
      modelCallCount: 2,
      toolCallCount: 1,
      failedToolCallCount: 1,
      modelLatencyMs: 23,
      runDurationMs: 4000,
      modelFailed: true,
    });
    expect(telemetryContainsForbiddenKeys(snapshot)).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain("Ava Nguyen");
    expect(JSON.stringify(snapshot)).not.toContain("1978-06-21");
    expect(JSON.stringify(snapshot)).not.toContain("patient_fictional_ava");
    expect(JSON.stringify(snapshot)).not.toContain("secret visit");
  });
});

describe("aggregateTelemetry", () => {
  it("computes cost, latency percentiles, tool-call average, and model failure rate", () => {
    const run = (overrides: Partial<ReturnType<typeof buildRunTelemetry>>): ReturnType<
      typeof buildRunTelemetry
    > => ({
      kind: "run_telemetry",
      runId: "run",
      agentName: "care_coordinator",
      status: "completed",
      failureCode: null,
      model: "scripted",
      modelVersion: "scripted",
      inputTokens: 10,
      outputTokens: 5,
      estimatedCostUsd: 1,
      modelCallCount: 1,
      toolCallCount: 2,
      failedToolCallCount: 0,
      modelLatencyMs: 10,
      runDurationMs: 100,
      modelFailed: false,
      ...overrides,
    });

    const aggregates = aggregateTelemetry([
      run({ runId: "a", estimatedCostUsd: 1, runDurationMs: 10, toolCallCount: 1, modelFailed: false }),
      run({ runId: "b", estimatedCostUsd: 3, runDurationMs: 20, toolCallCount: 3, modelFailed: true }),
      run({ runId: "c", estimatedCostUsd: 2, runDurationMs: 40, toolCallCount: 2, modelFailed: false }),
    ]);

    expect(aggregates.runCount).toBe(3);
    expect(aggregates.averageCostUsd).toBeCloseTo(2);
    expect(aggregates.averageToolCalls).toBeCloseTo(2);
    expect(aggregates.modelFailureRate).toBeCloseTo(1 / 3);
    expect(aggregates.p50LatencyMs).toBe(20);
    expect(aggregates.p95LatencyMs).toBeGreaterThanOrEqual(aggregates.p50LatencyMs);
    expect(percentile([10, 20, 40], 50)).toBe(20);
  });
});

describe("telemetryFromRun", () => {
  it("prefers the recorded snapshot when present", () => {
    const run: AgentRun = {
      id: "run_seed",
      patientId: "patient_fictional_ava",
      agentName: "care_coordinator",
      status: "completed",
      startedAt: new Date("2026-09-06T12:00:00.000Z"),
      completedAt: new Date("2026-09-06T12:00:12.000Z"),
    };
    const snapshot = buildRunTelemetry({
      runId: run.id,
      agentName: run.agentName,
      status: run.status,
      metadata,
      startedAt: run.startedAt,
      completedAt: run.completedAt ?? undefined,
      events: [],
    });
    const fromRun = telemetryFromRun(run, [
      event({
        id: "tel",
        eventType: "policy_decision",
        input: { kind: "run_telemetry" },
        output: snapshot,
      }),
    ]);
    expect(fromRun.runDurationMs).toBe(12000);
    expect(fromRun).not.toHaveProperty("patientId");
  });
});

describe("listEvalScoreHistory", () => {
  it("skips latest.json and sorts by startedAt", () => {
    const directory = join(tmpdir(), `carepilot-eval-${Date.now()}`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "latest.json"),
      JSON.stringify({
        startedAt: "2026-09-07T01:00:00.000Z",
        metrics: { passRate: 1, passedCount: 32, scenarioCount: 32 },
      }),
    );
    writeFileSync(
      join(directory, "older.json"),
      JSON.stringify({
        startedAt: "2026-09-06T01:00:00.000Z",
        finishedAt: "2026-09-06T01:01:00.000Z",
        gitSha: "aaa",
        model: "scripted",
        agentVersion: "0.1.0",
        metrics: { passRate: 0.9, passedCount: 29, scenarioCount: 32 },
      }),
    );
    writeFileSync(
      join(directory, "newer.json"),
      JSON.stringify({
        startedAt: "2026-09-07T02:00:00.000Z",
        finishedAt: "2026-09-07T02:01:00.000Z",
        gitSha: "bbb",
        model: "scripted",
        agentVersion: "0.1.0",
        metrics: { passRate: 1, passedCount: 32, scenarioCount: 32 },
      }),
    );

    const history = listEvalScoreHistory(directory);
    expect(history.map((point) => point.gitSha)).toEqual(["aaa", "bbb"]);
    expect(history[0]?.passRate).toBe(0.9);
    expect(toScorePoint({ metrics: {} })).toBeNull();
  });
});
