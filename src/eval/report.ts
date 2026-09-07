import { formatPercent, formatUsd } from "./score";
import type { EvalSuiteResult } from "./types";

export function formatEvalReport(result: EvalSuiteResult, previous?: EvalSuiteResult): string {
  const { metrics } = result;
  const lines = [
    `CarePilot eval ${result.agentVersion} @ ${result.gitSha}`,
    `${metrics.scenarioCount} scenarios  model=${result.model}  ${formatDuration(result)}`,
    "",
    pad("pass rate", formatPercent(metrics.passRate), `${metrics.passedCount}/${metrics.scenarioCount}`),
    pad("policy compliance", formatPercent(metrics.policyCompliance)),
    pad("tool-selection accuracy", formatPercent(metrics.toolSelectionAccuracy)),
    pad("evidence retrieval quality", formatPercent(metrics.evidenceRetrievalQuality)),
    pad("citation correctness", formatPercent(metrics.citationCorrectness)),
    pad("human-escalation correctness", formatPercent(metrics.humanEscalationCorrectness)),
    pad("prohibited-action rate", formatPercent(metrics.prohibitedActionRate)),
    pad("unsupported-claim rate", formatPercent(metrics.unsupportedClaimRate)),
    pad("average tool calls", metrics.averageToolCalls.toFixed(2)),
    pad("average latency", `${metrics.averageLatencyMs.toFixed(0)} ms`),
    pad("estimated model cost", formatUsd(metrics.estimatedModelCostUsd)),
    "",
    "by category:",
  ];

  for (const [category, row] of Object.entries(result.byCategory)) {
    lines.push(`  ${category.padEnd(32)} ${row.passed}/${row.count}  ${formatPercent(row.passRate)}`);
  }

  const failed = result.scenarios.filter((scenario) => !scenario.passed);
  if (failed.length > 0) {
    lines.push("", "failed scenarios:");
    for (const scenario of failed) {
      const detail = scenario.notes[0] ?? "category checks did not pass";
      lines.push(`  - ${scenario.id} (${scenario.category}): ${detail}`);
    }
  }

  if (previous) {
    lines.push("", `delta vs ${previous.agentVersion} @ ${previous.gitSha}:`);
    lines.push(deltaLine("pass rate", metrics.passRate, previous.metrics.passRate, true));
    lines.push(
      deltaLine("policy compliance", metrics.policyCompliance, previous.metrics.policyCompliance, true),
    );
    lines.push(
      deltaLine(
        "prohibited-action rate",
        metrics.prohibitedActionRate,
        previous.metrics.prohibitedActionRate,
        false,
      ),
    );
    lines.push(
      deltaLine(
        "unsupported-claim rate",
        metrics.unsupportedClaimRate,
        previous.metrics.unsupportedClaimRate,
        false,
      ),
    );
  }

  return `${lines.join("\n")}\n`;
}

function pad(label: string, value: string, extra = ""): string {
  const suffix = extra ? `  (${extra})` : "";
  return `  ${label.padEnd(32)} ${value}${suffix}`;
}

function formatDuration(result: EvalSuiteResult): string {
  const started = Date.parse(result.startedAt);
  const finished = Date.parse(result.finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) {
    return "";
  }
  const seconds = (finished - started) / 1000;
  if (seconds < 1) {
    return `${Math.max(1, Math.round(finished - started))}ms`;
  }
  return `${seconds.toFixed(1)}s`;
}

function deltaLine(label: string, current: number, previous: number, higherIsBetter: boolean): string {
  const delta = current - previous;
  const better = higherIsBetter ? delta >= 0 : delta <= 0;
  const sign = delta > 0 ? "+" : "";
  const marker = delta === 0 ? "=" : better ? "improved" : "regressed";
  return `  ${label.padEnd(32)} ${sign}${formatPercent(delta)}  ${marker}`;
}
