"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type DecisionActionView = {
  id: string;
  toolName: string;
  contentHash: string;
  status: "pending" | "approved" | "rejected";
  editField: string | null;
  editValue: string;
};

type Phase = { kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string } | {
  kind: "done";
  message: string;
};

/**
 * The client sends only a decision, the content hash it displayed, and any
 * edits. Every guard that matters lives behind the API route, so a modified
 * client can at most produce a rejected request.
 */
export function ActionDecisions({
  runId,
  action,
}: {
  runId: string;
  action: DecisionActionView;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(action.editValue);
  const [note, setNote] = useState("");

  const busy = phase.kind === "busy";

  async function submit(decision: "approve" | "reject" | "edit") {
    setPhase({ kind: "busy" });

    const response = await fetch(`/api/reviews/${runId}/actions/${action.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decision,
        expectedContentHash: action.contentHash,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(decision === "edit" && action.editField
          ? { edits: { [action.editField]: editValue } }
          : {}),
      }),
    });

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: { message?: string } }).error?.message ?? "request rejected")
          : `request rejected (${response.status})`;
      setPhase({ kind: "error", message });
      return;
    }

    const executed =
      typeof body === "object" && body !== null && "executed" in body
        ? Boolean((body as { executed: boolean }).executed)
        : false;
    const outcome =
      typeof body === "object" && body !== null && "decision" in body
        ? String((body as { decision: string }).decision)
        : decision;

    setEditing(false);
    setPhase({
      kind: "done",
      message: executed
        ? `Recorded as ${outcome} and executed through the tool gateway.`
        : `Recorded as ${outcome}. Nothing was executed.`,
    });
    router.refresh();
  }

  if (action.status !== "pending") {
    return (
      <p className="muted" data-testid={`decided-${action.id}`}>
        Decision recorded. Reopening this action requires a new agent run.
      </p>
    );
  }

  return (
    <div data-testid={`decision-controls-${action.id}`}>
      <div className="decision-controls">
        <button
          type="button"
          data-intent="approve"
          data-testid={`approve-${action.id}`}
          disabled={busy}
          onClick={() => void submit("approve")}
        >
          Approve and execute
        </button>
        <button
          type="button"
          data-intent="reject"
          data-testid={`reject-${action.id}`}
          disabled={busy}
          onClick={() => void submit("reject")}
        >
          Reject
        </button>
        {action.editField ? (
          <button
            type="button"
            data-intent="edit"
            data-testid={`edit-${action.id}`}
            disabled={busy}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? "Cancel edit" : "Edit"}
          </button>
        ) : null}
      </div>

      {editing && action.editField ? (
        <div className="edit-form">
          <label htmlFor={`edit-field-${action.id}`}>
            {action.editField} (saving returns this action to pending with a new content hash)
          </label>
          <textarea
            id={`edit-field-${action.id}`}
            data-testid={`edit-input-${action.id}`}
            rows={4}
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
          />
          <label htmlFor={`edit-note-${action.id}`}>Reason for the edit (optional)</label>
          <input
            id={`edit-note-${action.id}`}
            data-testid={`edit-note-${action.id}`}
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="decision-controls">
            <button
              type="button"
              data-testid={`save-edit-${action.id}`}
              disabled={busy}
              onClick={() => void submit("edit")}
            >
              Save revision
            </button>
          </div>
        </div>
      ) : null}

      {phase.kind === "error" ? (
        <p className="decision-error" role="alert" data-testid={`decision-error-${action.id}`}>
          {phase.message}
        </p>
      ) : null}
      {phase.kind === "done" ? (
        <p className="decision-result" data-testid={`decision-result-${action.id}`}>
          {phase.message}
        </p>
      ) : null}
    </div>
  );
}
