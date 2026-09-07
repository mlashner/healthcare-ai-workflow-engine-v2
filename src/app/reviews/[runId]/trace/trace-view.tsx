"use client";

import { useMemo, useState } from "react";

import { traceKindLabels, traceKinds, type TraceKind } from "@/trace/kinds";

export type SerializedTraceEvent = {
  id: string;
  kind: TraceKind;
  at: string;
  durationMs: number | null;
  actor: string | null;
  toolName: string | null;
  model: string | null;
  outcome: "success" | "failure" | "pending";
  input: unknown;
  output: unknown;
};

export function TraceView({ events }: { events: SerializedTraceEvent[] }) {
  const [enabled, setEnabled] = useState<Record<TraceKind, boolean>>(() =>
    Object.fromEntries(traceKinds.map((kind) => [kind, true])) as Record<TraceKind, boolean>,
  );

  const visible = useMemo(
    () => events.filter((event) => enabled[event.kind]),
    [events, enabled],
  );

  function toggle(kind: TraceKind) {
    setEnabled((current) => ({ ...current, [kind]: !current[kind] }));
  }

  return (
    <div>
      <form className="trace-filters" aria-label="Filter by event type" data-testid="trace-filters">
        {traceKinds.map((kind) => (
          <label key={kind}>
            <input
              type="checkbox"
              checked={enabled[kind]}
              onChange={() => toggle(kind)}
              data-testid={`trace-filter-${kind}`}
            />{" "}
            {traceKindLabels[kind]}
          </label>
        ))}
      </form>

      {visible.length === 0 ? (
        <p className="muted" data-testid="trace-empty">
          No events match the current filters.
        </p>
      ) : (
        <ol className="trace-timeline" data-testid="trace-timeline">
          {visible.map((event) => (
            <li
              key={event.id}
              className="trace-event"
              data-kind={event.kind}
              data-outcome={event.outcome}
              data-testid={`trace-event-${event.kind}`}
            >
              <div className="trace-event-head">
                <span className="provenance-tag">{traceKindLabels[event.kind]}</span>
                <span className="status-chip" data-status={chipStatus(event.outcome)}>
                  {event.outcome}
                </span>
                <time dateTime={event.at}>{event.at}</time>
                {event.durationMs !== null ? (
                  <span className="muted">{formatDuration(event.durationMs)}</span>
                ) : null}
              </div>
              <p className="muted">
                {[event.toolName, event.model, event.actor].filter(Boolean).join(" · ") ||
                  "control plane"}
              </p>
              {event.input !== null && event.input !== undefined ? (
                <Payload label="Input" value={event.input} />
              ) : null}
              {event.output !== null && event.output !== undefined ? (
                <Payload label="Output" value={event.output} />
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Payload({ label, value }: { label: string; value: unknown }) {
  return (
    <details>
      <summary>{label}</summary>
      <pre className="trace-payload">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function chipStatus(outcome: SerializedTraceEvent["outcome"]): "pending" | "approved" | "rejected" {
  if (outcome === "success") {
    return "approved";
  }
  if (outcome === "failure") {
    return "rejected";
  }
  return "pending";
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  return `${(ms / 1000).toFixed(1)} s`;
}
