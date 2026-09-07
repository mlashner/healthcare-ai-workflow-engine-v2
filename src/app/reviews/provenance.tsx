import type { ReactNode } from "react";

import type { Provenance } from "@/review/read-model";

/**
 * Six provenance kinds, six visual treatments. The label is rendered as text
 * (not only colour) so the distinction survives greyscale and screen readers.
 */
export const provenanceLabels: Record<Provenance, string> = {
  retrieved: "System retrieved",
  reasoning: "Model reasoning",
  proposal: "AI proposal — not executed",
  policy: "Policy decision",
  human: "Human decision",
  executed: "Executed action",
};

export const provenanceHints: Record<Provenance, string> = {
  retrieved: "Read from the fictional chart or knowledge base by a typed tool.",
  reasoning: "Model-generated inference. Not a clinical conclusion and not a fact.",
  proposal: "What the model suggested. Nothing has happened.",
  policy: "Deterministic rule evaluated in code, independent of the model.",
  human: "Recorded decision by a named clinician.",
  executed: "Ran through the tool gateway and changed durable state.",
};

export function ProvenanceBlock({
  kind,
  children,
  detail,
}: {
  kind: Provenance;
  children: ReactNode;
  detail?: string;
}) {
  return (
    <div className="provenance" data-provenance={kind}>
      <span className="provenance-tag">{provenanceLabels[kind]}</span>
      {detail ? <span className="muted"> {detail}</span> : null}
      <div className="provenance-body">{children}</div>
    </div>
  );
}

export function ProvenanceLegend() {
  return (
    <ul className="provenance-legend" aria-label="Provenance legend">
      {(Object.keys(provenanceLabels) as Provenance[]).map((kind) => (
        <li key={kind} className="provenance" data-provenance={kind} data-legend={kind}>
          <span className="provenance-tag">{provenanceLabels[kind]}</span>
        </li>
      ))}
    </ul>
  );
}
