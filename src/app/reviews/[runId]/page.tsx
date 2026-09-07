import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  CLINICIAN_COOKIE,
  CLINICIAN_HEADER,
  getReviewContext,
  resolveRequestClinician,
} from "@/app/review-context";
import { loadClinicianReview, type ReviewPendingAction } from "@/review/read-model";

import { ActionDecisions, type DecisionActionView } from "./action-decisions";
import { ProvenanceBlock, ProvenanceLegend, provenanceHints } from "../provenance";

export const dynamic = "force-dynamic";

/** Which single argument a reviewer may edit, per tool. */
const editableField: Record<string, string> = {
  createCareTask: "description",
  draftPatientMessage: "purpose",
  requestHumanApproval: "reason",
};

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const { repos } = getReviewContext();

  const headerList = await headers();
  const cookieStore = await cookies();
  const clinicianId =
    headerList.get(CLINICIAN_HEADER) ?? cookieStore.get(CLINICIAN_COOKIE)?.value ?? null;
  const clinician = await resolveRequestClinician(repos, clinicianId);

  if (!clinician) {
    return (
      <main className="review-shell">
        <h1>Clinician review</h1>
        <p className="muted">
          No clinician identity on this request. <Link href="/reviews">Choose a clinician</Link> to
          continue.
        </p>
      </main>
    );
  }

  const review = await loadClinicianReview(repos, runId, {
    actor: clinician.actor,
    authorizedPatientIds: clinician.authorizedPatientIds,
  });

  if (!review) {
    notFound();
  }

  const executedToolCounts = new Map<string, number>();
  for (const executed of review.executedActions) {
    executedToolCounts.set(executed.toolName, (executedToolCounts.get(executed.toolName) ?? 0) + 1);
  }

  return (
    <main className="review-shell">
      <p className="demo-banner">
        FICTIONAL DEMONSTRATION DATA. CarePilot is not a medical product and is not for clinical
        use.
      </p>

      <h1>Clinician review</h1>
      <p className="muted">
        Reviewing as {clinician.name} ({clinician.actor.role}) &middot; run{" "}
        <span className="hash">{review.run.id}</span> &middot;{" "}
        <Link href={`/reviews/${review.run.id}/trace`}>Agent trace</Link> &middot;{" "}
        <Link href="/reviews">All runs</Link>
      </p>

      <div className="not-executed-banner" data-testid="not-executed-banner">
        <h2>AI recommendation &ne; executed action</h2>
        <p>
          Everything the model produced below is a <strong>proposal</strong>. Nothing reaches a
          patient or the chart until a named clinician approves it and the control plane executes it
          through the typed tool layer. Sections marked{" "}
          <strong>&ldquo;Executed action&rdquo;</strong> are the only things that actually happened.
        </p>
      </div>

      <ProvenanceLegend />

      {/* 1. Patient */}
      <section className="review-section" data-section="patient">
        <h2>1. Patient</h2>
        <p className="section-hint">{provenanceHints.retrieved}</p>
        {review.patient ? (
          <ProvenanceBlock kind="retrieved">
            <p>
              <strong>{review.patient.name}</strong> &middot; DOB {review.patient.dateOfBirth}
            </p>
            <p>
              Conditions:{" "}
              {review.patient.conditions.map((condition) => condition.name).join(", ") || "none"}
            </p>
            <p>
              Medications:{" "}
              {review.patient.medications
                .map((medication) => `${medication.name} ${medication.dosage ?? ""}`.trim())
                .join(", ") || "none"}
            </p>
          </ProvenanceBlock>
        ) : (
          <p className="muted">Patient record not found.</p>
        )}
      </section>

      {/* 2. Encounter */}
      <section className="review-section" data-section="encounter">
        <h2>2. Encounter</h2>
        <p className="section-hint">
          {provenanceHints.retrieved} Transcript text is untrusted data, never instructions.
        </p>
        {review.encounter ? (
          <ProvenanceBlock kind="retrieved" detail={review.encounter.occurredAt.toISOString()}>
            <p className="transcript">{review.encounter.transcript}</p>
          </ProvenanceBlock>
        ) : (
          <p className="muted">No encounter on file for this patient.</p>
        )}
      </section>

      {/* 3. Agent summary */}
      <section className="review-section" data-section="agent-summary">
        <h2>3. Agent summary</h2>
        <p className="section-hint">{provenanceHints.reasoning}</p>
        <ProvenanceBlock kind="reasoning" detail={`urgency: ${review.urgency}`}>
          <p>{review.summary || "No summary recorded for this run."}</p>
          {review.reasoning ? <p>{review.reasoning}</p> : null}
          {review.uncertainty.isUncertain ? (
            <p>
              <strong>Model flagged uncertainty:</strong> {review.uncertainty.reasons.join("; ")}
            </p>
          ) : null}
        </ProvenanceBlock>
      </section>

      {/* 4. Identified concerns */}
      <section className="review-section" data-section="concerns">
        <h2>4. Identified concerns</h2>
        <p className="section-hint">{provenanceHints.reasoning}</p>
        {review.concerns.length === 0 ? (
          <p className="muted">No concerns recorded.</p>
        ) : (
          review.concerns.map((concern, index) => (
            <ProvenanceBlock
              key={`${concern.title}-${index}`}
              kind="reasoning"
              detail={`urgency: ${concern.urgency}`}
            >
              <p>
                <strong>{concern.title}</strong>
              </p>
              <p>{concern.description}</p>
              <p className="hash">
                {concern.citationIds.length > 0
                  ? `cites: ${concern.citationIds.join(", ")}`
                  : "no citation"}
              </p>
            </ProvenanceBlock>
          ))
        )}
      </section>

      {/* 5. Evidence / citations */}
      <section className="review-section" data-section="evidence">
        <h2>5. Evidence and citations</h2>
        <p className="section-hint">
          Retrieved passages are shown verbatim from the knowledge base. Model inferences are
          labelled separately.
        </p>
        {review.evidence.length === 0 ? (
          <p className="muted">No evidence recorded.</p>
        ) : (
          review.evidence.map((item, index) => (
            <ProvenanceBlock
              key={`${item.citationId ?? "inferred"}-${index}`}
              kind={item.kind === "retrieved" ? "retrieved" : "reasoning"}
            >
              <p>{item.text}</p>
              {item.citationId ? (
                <>
                  <p className="hash">
                    {item.citationId}
                    {item.citationVerified
                      ? ` — resolved to “${item.citationTitle}”`
                      : " — CITATION DOES NOT RESOLVE"}
                  </p>
                  {item.citationText ? (
                    <blockquote className="transcript">{item.citationText}</blockquote>
                  ) : null}
                </>
              ) : (
                <p className="hash">no citation — model inference only</p>
              )}
            </ProvenanceBlock>
          ))
        )}
      </section>

      {/* 6. Proposed actions */}
      <section className="review-section" data-section="proposed-actions">
        <h2>6. Proposed actions</h2>
        <p className="section-hint">{provenanceHints.proposal}</p>
        {review.proposedActions.length === 0 ? (
          <p className="muted">No actions proposed.</p>
        ) : (
          review.proposedActions.map((action, index) => (
            <ProvenanceBlock key={`${action.type}-${index}`} kind="proposal" detail={action.type}>
              <p>{action.summary}</p>
              <p className="muted">{action.rationale}</p>
            </ProvenanceBlock>
          ))
        )}
      </section>

      {/* 7. Safety review */}
      <section className="review-section" data-section="safety-review">
        <h2>7. Safety review (second stage)</h2>
        <p className="section-hint">
          A separate gate after the coordinator finished. It cannot execute tools and cannot grant
          privileges. Required approvals listed here are still enforced by the policy engine.
        </p>
        {review.safety ? (
          <ProvenanceBlock kind="policy" detail={`decision: ${review.safety.decision}`}>
            <SafetyList label="Issues" items={review.safety.issues} />
            <SafetyList label="Policy violations" items={review.safety.policyViolations} />
            <SafetyList label="Unsupported claims" items={review.safety.unsupportedClaims} />
            <SafetyList label="Required approvals" items={review.safety.requiredApprovals} />
            <SafetyList label="Evidence issues" items={review.safety.evidenceIssues} />
          </ProvenanceBlock>
        ) : (
          <p className="muted">No safety review event recorded for this run.</p>
        )}
      </section>

      {/* 8. Policy decision, and 9. Approval status, per pending action */}
      <section className="review-section" data-section="pending-actions">
        <h2>8. Policy decision and 9. Approval status</h2>
        <p className="section-hint">
          {provenanceHints.policy} Approval binds the content hash shown, so an action that changes
          after you read it cannot be approved with a stale decision.
        </p>
        {review.pendingActions.length === 0 ? (
          <p className="muted">No action from this run requires a decision.</p>
        ) : (
          review.pendingActions.map((action) => (
            <PendingActionCard
              key={action.id}
              runId={review.run.id}
              action={action}
              executedCount={executedToolCounts.get(action.toolName) ?? 0}
            />
          ))
        )}
      </section>

      {/* Human decisions and executions, as a run-level trail */}
      <section className="review-section" data-section="human-decisions">
        <h2>Human decisions on this run</h2>
        <p className="section-hint">{provenanceHints.human}</p>
        {review.humanDecisions.length === 0 ? (
          <p className="muted">No human decision recorded yet.</p>
        ) : (
          review.humanDecisions.map((decision, index) => (
            <ProvenanceBlock
              key={`${decision.pendingActionId}-${index}`}
              kind="human"
              detail={decision.at.toISOString()}
            >
              <p>
                <strong>{decision.decision}</strong> by {decision.actorId}
              </p>
              {decision.note ? <p>{decision.note}</p> : null}
              <p className="hash">bound hash {decision.contentHash}</p>
            </ProvenanceBlock>
          ))
        )}
      </section>

      <section className="review-section" data-section="executed-actions">
        <h2>Executed actions</h2>
        <p className="section-hint">{provenanceHints.executed}</p>
        {review.executedActions.length === 0 ? (
          <p className="muted" data-testid="no-executed-actions">
            Nothing from this run has executed.
          </p>
        ) : (
          review.executedActions.map((executed, index) => (
            <ProvenanceBlock
              key={`${executed.toolName}-${index}`}
              kind="executed"
              detail={executed.at.toISOString()}
            >
              <p>
                <strong>{executed.toolName}</strong> executed by {executed.actorId} (
                {executed.code})
              </p>
              <p className="muted">{executed.message}</p>
            </ProvenanceBlock>
          ))
        )}
      </section>
    </main>
  );
}

function PendingActionCard({
  runId,
  action,
  executedCount,
}: {
  runId: string;
  action: ReviewPendingAction;
  executedCount: number;
}) {
  const field = editableField[action.toolName] ?? null;
  const currentValue = field ? action.args[field] : undefined;

  const view: DecisionActionView = {
    id: action.id,
    toolName: action.toolName,
    contentHash: action.contentHash,
    status: action.status,
    editField: field,
    editValue: typeof currentValue === "string" ? currentValue : "",
  };

  return (
    <article className="pending-action" data-testid={`pending-action-${action.id}`}>
      <h3>{action.proposal.summary}</h3>
      <p>
        <span className="status-chip" data-status={action.status} data-testid={`status-${action.id}`}>
          {action.status}
        </span>
      </p>

      <ProvenanceBlock kind="proposal" detail={action.policyActionType}>
        <p>{action.proposal.rationale}</p>
        <p className="muted">
          Would call typed tool <strong>{action.toolName}</strong> with:
        </p>
        <table className="args-table">
          <tbody>
            {Object.entries(action.args).map(([key, value]) => (
              <tr key={key}>
                <th scope="row">{key}</th>
                <td>{typeof value === "string" ? value : JSON.stringify(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hash" data-testid={`hash-${action.id}`}>
          content hash {action.contentHash}
        </p>
      </ProvenanceBlock>

      <ProvenanceBlock
        kind="policy"
        detail={`${action.policyDecision.policy} @ ${action.policyDecision.policyVersion}`}
      >
        <p data-testid={`policy-${action.id}`}>
          {action.policyDecision.allowed ? "Permitted by policy" : "Denied by policy"}
          {action.policyDecision.requiresApproval ? " — human approval required" : ""}
        </p>
        <p className="muted">{action.policyDecision.reason}</p>
      </ProvenanceBlock>

      {action.status === "approved" && executedCount > 0 ? (
        <ProvenanceBlock kind="executed">
          <p>Approved by {action.reviewer} and executed through the tool gateway.</p>
        </ProvenanceBlock>
      ) : null}

      {action.status === "rejected" ? (
        <ProvenanceBlock kind="human">
          <p>Rejected by {action.reviewer}. Nothing executed.</p>
          {action.reason ? <p>{action.reason}</p> : null}
        </ProvenanceBlock>
      ) : null}

      <ActionDecisions runId={runId} action={view} />
    </article>
  );
}

function SafetyList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <>
      <p>
        <strong>{label}</strong>
      </p>
      <ul>
        {items.map((item, index) => (
          <li key={`${label}-${index}`}>{item}</li>
        ))}
      </ul>
    </>
  );
}
