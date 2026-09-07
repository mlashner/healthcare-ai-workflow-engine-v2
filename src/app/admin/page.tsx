import Link from "next/link";

import { getReviewContext } from "@/app/review-context";
import {
  aggregateTelemetry,
  listEvalScoreHistory,
  telemetryFromRun,
  type EvalScorePoint,
  type RunTelemetry,
} from "@/observability";

export const dynamic = "force-dynamic";

export default async function AdminObservabilityPage() {
  const { repos } = getReviewContext();
  const runs = await repos.agentRuns.listRecent(100);
  const snapshots: RunTelemetry[] = await Promise.all(
    runs.map(async (run) => telemetryFromRun(run, await repos.agentEvents.listByAgentRunId(run.id))),
  );
  const aggregates = aggregateTelemetry(snapshots);
  const evalHistory = listEvalScoreHistory();

  return (
    <main className="admin-shell">
      <p className="demo-banner">
        FICTIONAL DEMONSTRATION DATA. CarePilot is not a medical product and is not for clinical
        use. This admin view shows numeric run metrics only — no chart text, names, or transcripts.
      </p>
      <p className="muted">
        <Link href="/">Home</Link>
        {" · "}
        <Link href="/reviews">Clinician review</Link>
      </p>
      <h1>AI observability</h1>
      <p className="muted">
        Per-run counters are written by the control plane. Patient identifiers are omitted from
        snapshots and from this page. In production this surface would be restricted to operators,
        not clinicians.
      </p>

      <section className="review-section" aria-labelledby="aggregate-heading">
        <h2 id="aggregate-heading">Aggregate metrics</h2>
        <p className="section-hint">
          Across the {aggregates.runCount} most recent agent runs. Latency percentiles use total run
          duration.
        </p>
        <div className="metric-grid">
          <MetricCard
            testId="metric-average-cost"
            label="Average cost/run"
            value={formatUsd(aggregates.averageCostUsd)}
          />
          <MetricCard
            testId="metric-p50-latency"
            label="p50 latency"
            value={formatMs(aggregates.p50LatencyMs)}
          />
          <MetricCard
            testId="metric-p95-latency"
            label="p95 latency"
            value={formatMs(aggregates.p95LatencyMs)}
          />
          <MetricCard
            testId="metric-average-tool-calls"
            label="Average tool calls"
            value={aggregates.averageToolCalls.toFixed(2)}
          />
          <MetricCard
            testId="metric-model-failure-rate"
            label="Model failure rate"
            value={formatPercent(aggregates.modelFailureRate)}
          />
        </div>
      </section>

      <EvalScoreSection history={evalHistory} />

      <section className="review-section" aria-labelledby="runs-heading">
        <h2 id="runs-heading">Recent runs</h2>
        <p className="section-hint">
          Model identity, tokens, cost, and call counts. Run ids are opaque. Patient scope is not
          listed.
        </p>
        {snapshots.length === 0 ? (
          <p className="muted">No agent runs have been recorded yet.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Agent</th>
                  <th>Status</th>
                  <th>Model</th>
                  <th>Cost</th>
                  <th>Duration</th>
                  <th>Model calls</th>
                  <th>Tool calls</th>
                  <th>Failed tools</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((row) => (
                  <tr key={row.runId}>
                    <td className="hash">{row.runId}</td>
                    <td>{row.agentName}</td>
                    <td>{row.status}</td>
                    <td>
                      {row.model}
                      {row.modelVersion !== row.model ? ` @ ${row.modelVersion}` : ""}
                    </td>
                    <td>{formatUsd(row.estimatedCostUsd)}</td>
                    <td>{formatMs(row.runDurationMs)}</td>
                    <td>{row.modelCallCount}</td>
                    <td>{row.toolCallCount}</td>
                    <td>{row.failedToolCallCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function EvalScoreSection({ history }: { history: EvalScorePoint[] }) {
  const maxRate = Math.max(1, ...history.map((point) => point.passRate));

  return (
    <section className="review-section" aria-labelledby="eval-heading">
      <h2 id="eval-heading">Evaluation score over time</h2>
      <p className="section-hint">
        Pass rate from <code>npm run eval</code> result files. Chart text from scenarios is not
        loaded here.
      </p>
      {history.length === 0 ? (
        <p className="muted" data-testid="eval-empty">
          No evaluation suites yet. Run <code>npm run eval</code> to write a comparable report.
        </p>
      ) : (
        <>
          <ol className="eval-bars" data-testid="eval-score-history">
            {history.map((point) => (
              <li key={`${point.startedAt}-${point.gitSha}`}>
                <span
                  className="eval-bar"
                  style={{ height: `${Math.max(4, (point.passRate / maxRate) * 100)}%` }}
                  title={`${formatPercent(point.passRate)} at ${point.startedAt}`}
                />
                <time dateTime={point.startedAt}>{shortDate(point.startedAt)}</time>
              </li>
            ))}
          </ol>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Pass rate</th>
                  <th>Passed</th>
                  <th>Model</th>
                  <th>Version</th>
                  <th>git</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((point) => (
                  <tr key={`${point.startedAt}-${point.gitSha}-row`}>
                    <td>{point.startedAt}</td>
                    <td>{formatPercent(point.passRate)}</td>
                    <td>
                      {point.passedCount}/{point.scenarioCount}
                    </td>
                    <td>{point.model}</td>
                    <td>{point.agentVersion}</td>
                    <td className="hash">{point.gitSha}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function MetricCard({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="metric-card" data-testid={testId}>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
    </div>
  );
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatMs(value: number): string {
  return `${Math.round(value)} ms`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso.slice(0, 10);
  }
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}
